"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { getStaffAccessToken } from "@/components/ui/staff-access";
import { ApiError, createApiClient } from "@/shared/api-client";
import { activeQueue, completedRecordMatches, completionRecordSchema, selectQueueOrder, type CompletionRecord } from "./queue-state";
import type { Ticket } from "@/shared/contracts";

import styles from "./order-queue.module.css";

const sourceLabels: Record<Ticket["source"], string> = {
  web: "Web order",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  voice: "Voice order",
};

type QueueError = { message: string; authRequired: boolean; accessDenied: boolean };

function money(cents: number) {
  return new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(cents / 100);
}

function receivedTime(value: string | number) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit", second: "2-digit",
  }).format(new Date(value));
}

function classifyError(error: unknown): QueueError {
  if (error instanceof ApiError && error.status === 401) {
    return { message: "Please sign in again to get the latest orders.", authRequired: true, accessDenied: false };
  }
  if (error instanceof ApiError && error.status === 403) {
    return { message: "This account doesn’t have access to this stall. Sign in with the stall’s staff account.", authRequired: false, accessDenied: true };
  }
  return { message: "We couldn’t get the latest orders. Check your connection and try again.", authRequired: false, accessDenied: false };
}

function ServiceBadge({ ticket }: { ticket: Ticket }) {
  return <span className={styles.serviceBadge} data-service={ticket.cart.fulfillmentType ?? "unknown"}>{ticket.cart.fulfillmentType === "dine_in" ? "Dine-in" : ticket.cart.fulfillmentType === "takeaway" ? "Takeaway" : "Dining choice not recorded"}</span>;
}

function DishLines({ ticket, compact = false }: { ticket: Ticket; compact?: boolean }) {
  return (
    <ul className={compact ? styles.compactLines : styles.dishLines}>
      {ticket.cart.lines.map((line, index) => (
        <li key={`${line.dishId}-${index}`}>
          <div className={styles.dishHeading}>
            <strong className={styles.quantity} aria-label={`Quantity ${line.quantity}`}>{line.quantity}×</strong>
            <strong className={styles.dishName}>{line.name}</strong>
          </div>
          {line.options.length > 0 && (
            <ul className={styles.modifiers} aria-label={`Options for ${line.name}`}>
              {line.options.map(option => <li key={option.id}>{option.name}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export function OrderQueue({ restaurantId }: { restaurantId: string }) {
  const [orders, setOrders] = useState<Ticket[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [error, setError] = useState<QueueError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [counts, setCounts] = useState({ received: 0, done: 0, total: 0 });
  const [completion, setCompletion] = useState<CompletionRecord | null>(null);
  const completionRef = useRef<CompletionRecord | null>(null);
  const [completing, setCompleting] = useState(false);
  const completingRef = useRef(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const mutationEpoch = useRef(0);
  const storageKey = `jiak-kitchen-completion:${restaurantId}`;
  const retryRef = useRef<() => void>(() => {});
  const invalidateRequests = useCallback(() => { mutationEpoch.current++; completingRef.current = false; }, []);

  useEffect(() => {
    let stopped = false;
    let hydrated = false;
    mutationEpoch.current++;
    let inFlight = false;
    let blocked = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function refresh() {
      if (stopped || inFlight || completingRef.current) return;
      if (!hydrated) {
        hydrated = true;
        setOrders(null); setSelectedId(null); setLastUpdated(null); setCounts({ received: 0, done: 0, total: 0 }); setCompleting(false); setStorageBlocked(false); setActionMessage(null);
        completionRef.current = null; setCompletion(null);
        try {
          const raw = sessionStorage.getItem(storageKey);
          if (raw) {
            const saved = completionRecordSchema.parse(JSON.parse(raw));
            if (saved.input.restaurantId !== restaurantId) throw new Error("Wrong restaurant");
            completionRef.current = saved; setCompletion(saved); setSelectedId(saved.input.orderId);
            setActionMessage("A saved kitchen update needs checking. Refresh or retry the same update.");
          }
        } catch { setStorageBlocked(true); setActionMessage("We couldn't safely read the saved kitchen update. Check the order with the stall before changing it."); }
      }
      const refreshEpoch = mutationEpoch.current;
      if (timer) clearTimeout(timer);
      inFlight = true;
      controller = new AbortController();
      const signal = controller.signal;
      setRefreshing(true);
      try {
        const token = await getStaffAccessToken();
        if (stopped || signal.aborted) return;
        const api = createApiClient("", (input, init) => fetch(input, { ...init, signal }));
        const result = await api.kitchen(restaurantId, token);
        if (stopped || signal.aborted || refreshEpoch !== mutationEpoch.current) return;
        if (result.orders.some(ticket => ticket.cart.restaurantId !== restaurantId)) throw new Error("These orders could not be matched to this stall.");
        setOrders(result.orders); setCounts(result.counts);
        const outstanding = completionRef.current;
        if (outstanding && result.orders.some(ticket => completedRecordMatches(outstanding, ticket))) {
          try { sessionStorage.removeItem(storageKey); completionRef.current = null; setCompletion(null); setActionMessage("Order marked done. Payment remains unpaid."); }
          catch { setStorageBlocked(true); setActionMessage("Done is saved, but this browser couldn't clear its retry record. Keep this page open."); }
        }
        setSelectedId(previous => completionRef.current ? completionRef.current.input.orderId : selectQueueOrder(result.orders, previous));
        setLastUpdated(Date.now());
        setError(null);
        blocked = false;
      } catch (caught) {
        if (stopped || signal.aborted) return;
        const nextError = classifyError(caught);
        blocked = nextError.authRequired || nextError.accessDenied;
        setError(nextError);
        // Keep every previously loaded ticket visible when a refresh fails.
      } finally {
        inFlight = false;
        if (!stopped) {
          setRefreshing(false);
          if (!blocked) timer = setTimeout(() => void refresh(), 2_000);
        }
      }
    }

    retryRef.current = () => { blocked = false; void refresh(); };
    void refresh();
    return () => {
      stopped = true;
      invalidateRequests();
      if (timer) clearTimeout(timer);
      controller?.abort();
      retryRef.current = () => {};
    };
  }, [restaurantId, storageKey, invalidateRequests]);

  async function completeOrder(ticket?: Ticket) {
    if (completingRef.current || storageBlocked || error?.authRequired || error?.accessDenied) return;
    const retrying = completionRef.current !== null;
    if (!completionRef.current && !ticket) return;
    const record = completionRef.current ?? { input: { restaurantId, orderId: ticket!.id, expectedStatusVersion: ticket!.statusVersion }, key: crypto.randomUUID(), uncertain: false };
    if ((ticket && record.input.orderId !== ticket.id) || record.input.restaurantId !== restaurantId) return;
    const dispatched = { ...record, uncertain: true };
    try { sessionStorage.setItem(storageKey, JSON.stringify(dispatched)); }
    catch { setStorageBlocked(true); setActionMessage("This browser couldn't save the update safely. Nothing new was sent."); return; }
    completionRef.current = dispatched; setCompletion(dispatched);
    completingRef.current = true; setCompleting(true);
    const epoch = ++mutationEpoch.current;
    setActionMessage("Saving Done…");
    try {
      const token = await getStaffAccessToken();
      if (epoch !== mutationEpoch.current) return;
      const saved = await createApiClient().completeKitchenOrder(record.input, record.key, token);
      if (epoch !== mutationEpoch.current) return;
      if (!completedRecordMatches(record, saved)) throw new Error("Completion receipt mismatch");
      setActionMessage("Done saved. Checking the updated queue…");
    } catch (caught) {
      if (epoch !== mutationEpoch.current) return;
      if (!retrying && caught instanceof ApiError && caught.status === 409 && caught.code === "STALE_STATUS") {
        try { sessionStorage.removeItem(storageKey); completionRef.current = null; setCompletion(null); }
        catch { setStorageBlocked(true); }
        setActionMessage("This order changed on another screen. Refreshing—check it before choosing Done again.");
      } else setActionMessage("This update may already be saved. Refresh or retry the same update; no new completion will be created.");
    } finally {
      if (epoch === mutationEpoch.current) { completingRef.current = false; setCompleting(false); retryRef.current(); }
    }
  }

  const queue = activeQueue(orders ?? []);
  const currentIndex = queue.findIndex(ticket => ticket.id === selectedId);
  const current = queue[currentIndex];
  const remaining = current ? [...queue.slice(currentIndex + 1), ...queue.slice(0, currentIndex)] : [];
  const upcoming = remaining.slice(0, 2);
  const additionalCount = Math.max(0, remaining.length - upcoming.length);
  const nextPath = `/kitchen?restaurantId=${encodeURIComponent(restaurantId)}`;
  const loginHref = `/login?next=${encodeURIComponent(nextPath)}`;

  return (
    <div className={styles.kitchen}>
      <header className={styles.header}>
        <div>
          <h1>Cook mode</h1>
        </div>
        <div className={styles.connection}>
          <span className={`${styles.connectionBadge} ${error ? styles.staleBadge : ""}`}>
            <span aria-hidden="true">●</span> {error ? "Updates paused" : lastUpdated ? "Live orders" : "Connecting…"}
          </span>
          <button type="button" className="btn btn-outline" disabled={refreshing} onClick={() => retryRef.current()}>
            {refreshing ? "Checking…" : "Refresh orders"}
          </button>
        </div>
      </header>

      {actionMessage && <div className="notice" role="status"><p>{actionMessage}</p>{completion && <button type="button" className="btn btn-outline" disabled={completing || refreshing || storageBlocked || !!error?.authRequired || !!error?.accessDenied} onClick={() => void completeOrder()}>{completing ? "Saving…" : "Retry same kitchen update"}</button>}</div>}
      {orders !== null && <p className={styles.queueSummary} aria-live="polite"><strong>{counts.received} in queue</strong><span>{counts.done} done · {counts.total} total</span></p>}
      {error && (
        <div className={`notice ${styles.errorNotice}`} role="alert">
          <div>
            <strong>{error.authRequired || error.accessDenied ? "Order updates are paused" : "Latest orders couldn’t load"}</strong>
            <p>{error.message}</p>
            {orders !== null && <p>Showing the last loaded queue.</p>}
          </div>
          {error.authRequired || error.accessDenied ? (
            <Link href={loginHref} className="btn btn-teal">Sign in</Link>
          ) : (
            <button type="button" className="btn btn-teal" disabled={refreshing} onClick={() => retryRef.current()}>Try again</button>
          )}
        </div>
      )}

      {orders === null && !error && (
        <div className={`card ${styles.empty}`} role="status">
          <span className={styles.loadingDot} aria-hidden="true" />
          <h2>Getting your orders…</h2>
        </div>
      )}

      {orders !== null && queue.length === 0 && (
        <div className={`card ${styles.empty}`}>
          <p className={styles.emptySymbol} aria-hidden="true">✓</p>
          <h2>{error ? "No orders in the last loaded queue" : "No orders just yet"}</h2>
          <p>{error ? "Refresh to check for new orders." : "New orders appear automatically."}</p>
          <Link href={`/storefront?restaurantId=${encodeURIComponent(restaurantId)}`} className="btn btn-outline">View your menu QR</Link>
        </div>
      )}

      {current && (
        <div className={styles.cookLayout}>
          <div className={styles.preparing}>
            <div className={styles.preparingHeading}><h2 id="current-order-title">{currentIndex === 0 ? "Preparing now" : "Viewing order"}</h2><ServiceBadge ticket={current} /></div>
            <article className={`card ${styles.currentOrder}`} aria-labelledby="current-order-title">
              <div className={styles.currentTop}>
                <div><p className={styles.ticketReference}>#{current.id.slice(0, 8).toUpperCase()}</p><p className={styles.received}><time dateTime={current.createdAt}>{receivedTime(current.createdAt)}</time> · {sourceLabels[current.source]}</p></div>
                <span className={styles.paymentBadge}>Unpaid</span>
              </div>
              <div className={styles.ticketBody}>
            <div className={styles.currentLines} tabIndex={0} aria-label="Current order dishes"><DishLines ticket={current} /></div>
            <div className={styles.orderTotal}><span>Total</span><strong>{money(current.cart.totalCents)}</strong></div>
            <div className={styles.orderActions}>
              <button type="button" className={`btn btn-primary ${styles.doneButton}`} disabled={completing || storageBlocked || refreshing || !!error || (completion !== null && completion.input.orderId !== current.id)} onClick={() => void completeOrder(current)} aria-describedby="completion-note">
                {completing ? "Saving…" : completion?.input.orderId === current.id ? "Retry same Done update" : "Done, next order"} <span aria-hidden="true">→</span>
              </button>
              <p id="completion-note" className={styles.completionNote}>Done means ready. Payment is separate.</p>
            </div>
              </div>
            </article>
              <div className={styles.viewActions}>
                <button type="button" className="btn btn-outline" disabled={completing || completion !== null || remaining.length === 0} onClick={() => setSelectedId(remaining[0]?.id ?? current.id)}>
                  View next order <span aria-hidden="true">→</span>
                </button>
                {currentIndex > 0 && <button type="button" className="btn btn-outline" disabled={completing || completion !== null} onClick={() => setSelectedId(queue[0].id)}>Back to oldest order</button>}
              </div>
            <details className={styles.fullId}><summary>Full order reference</summary><code>{current.id}</code></details>
          </div>

          <section className={styles.upNext} aria-labelledby="next-orders-title">
            <div className={styles.sectionHeading}>
              <h2 id="next-orders-title">What’s next</h2>
              <span>{remaining.length} {remaining.length === 1 ? "other order" : "other orders"}</span>
            </div>
            {upcoming.length > 0 ? (
              <div className={styles.previewGrid}>
                {upcoming.map((ticket, index) => (
                  <article key={ticket.id} className={`card ${styles.previewCard}`}>
                    <div className={styles.previewHeader}>
                      <h3>{index === 0 ? "Next up" : "After that"}</h3>
                      <ServiceBadge ticket={ticket} />
                    </div>
                    <div className={styles.nextLines} tabIndex={0} aria-label={`Upcoming order ${index + 1}`}><DishLines ticket={ticket} compact /></div>
                    <button type="button" className="btn btn-outline" disabled={completing || completion !== null} onClick={() => setSelectedId(ticket.id)} aria-label={`View order ${ticket.id}`}>View order</button>
                  </article>
                ))}
              </div>
            ) : <p className={styles.noNext}>No more orders.</p>}
            {additionalCount > 0 && <p className={styles.moreOrders}>+ {additionalCount} more {additionalCount === 1 ? "order" : "orders"} in queue</p>}
          </section>
        </div>
      )}
    </div>
  );
}
