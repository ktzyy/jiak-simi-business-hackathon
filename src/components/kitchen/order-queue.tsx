"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { getStaffAccessToken } from "@/components/ui/staff-access";
import { ApiError, createApiClient } from "@/shared/api-client";
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

function ServiceBadge() {
  return <span className={styles.serviceBadge}>Dine-in / takeaway not provided</span>;
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
  const retryRef = useRef<() => void>(() => {});

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let blocked = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function refresh() {
      if (stopped || inFlight) return;
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
        if (stopped || signal.aborted) return;
        if (result.orders.some(ticket => ticket.cart.restaurantId !== restaurantId)) throw new Error("These orders could not be matched to this stall.");
        const sorted = [...result.orders].sort((a, b) =>
          Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
        setOrders(sorted);
        setSelectedId(previous => sorted.some(ticket => ticket.id === previous) ? previous : sorted[0]?.id ?? null);
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
      if (timer) clearTimeout(timer);
      controller?.abort();
      retryRef.current = () => {};
    };
  }, [restaurantId]);

  const queue = orders ?? [];
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
          <p className={styles.eyebrow}>Keep cooking. We’ll keep the orders in view.</p>
          <h1>Cook mode</h1>
          <p className={styles.intro}>Clear orders, one at a time.</p>
        </div>
        <div className={styles.connection}>
          <span className={`${styles.connectionBadge} ${error ? styles.staleBadge : ""}`}>
            <span aria-hidden="true">●</span> {error ? "Orders may be out of date" : lastUpdated ? "Checking for new orders" : "Connecting to your kitchen"}
          </span>
          <p>{lastUpdated ? <>Last updated <time dateTime={new Date(lastUpdated).toISOString()}>{receivedTime(lastUpdated)}</time></> : "Waiting for the first update"}</p>
          <button type="button" className="btn btn-outline" disabled={refreshing} onClick={() => retryRef.current()}>
            {refreshing ? "Checking…" : "Refresh orders"}
          </button>
        </div>
      </header>

      {error && (
        <div className={`notice ${styles.errorNotice}`} role="alert">
          <div>
            <strong>{error.authRequired || error.accessDenied ? "Order updates are paused" : "Latest orders couldn’t load"}</strong>
            <p>{error.message}</p>
            {orders !== null && <p>Your last loaded queue is still below. New orders may be missing.</p>}
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
          <p>They’ll appear here as soon as they’re ready.</p>
        </div>
      )}

      {orders !== null && queue.length === 0 && (
        <div className={`card ${styles.empty}`}>
          <p className={styles.emptySymbol} aria-hidden="true">✓</p>
          <h2>{error ? "No orders in the last loaded queue" : "No orders just yet"}</h2>
          <p>{error ? "Refresh to check for new orders." : "New orders from your menu will appear here. You can leave this screen open."}</p>
          <Link href={`/storefront?restaurantId=${encodeURIComponent(restaurantId)}`} className="btn btn-outline">View your menu QR</Link>
        </div>
      )}

      {current && (
        <>
          <div className={styles.queueSummary}>
            <p aria-live="polite"><strong>{queue.length}</strong> {queue.length === 1 ? "order" : "orders"} in queue</p>
            <p>Oldest orders appear first · Viewing an order keeps it in the queue</p>
          </div>

          <article className={`card ${styles.currentOrder}`} aria-labelledby="current-order-title">
            <div className={styles.currentTop}>
              <div>
                <p className={styles.eyebrow}>{currentIndex === 0 ? "Oldest order" : "Viewing order"}</p>
                <h2 id="current-order-title">Current order</h2>
                <p className={styles.received}>Received <time dateTime={current.createdAt}>{receivedTime(current.createdAt)}</time> · {sourceLabels[current.source]}</p>
              </div>
              <span className={styles.paymentBadge}>Unpaid</span>
            </div>
            <ServiceBadge />
            <DishLines ticket={current} />
            <div className={styles.orderTotal}><span>Order total</span><strong>{money(current.cart.totalCents)}</strong></div>
            <p className={styles.fullId}>Full order ID: <code>{current.id}</code></p>
            <div className={styles.orderActions}>
              <button type="button" className={`btn btn-teal ${styles.doneButton}`} disabled aria-describedby="completion-note">
                Done, next order <span aria-hidden="true">→</span>
              </button>
              <p id="completion-note" className={styles.completionNote}>Marking orders done is not available yet.</p>
              <div className={styles.viewActions}>
                <button type="button" className="btn btn-outline" disabled={remaining.length === 0} onClick={() => setSelectedId(remaining[0]?.id ?? current.id)}>
                  View next order <span aria-hidden="true">→</span>
                </button>
                {currentIndex > 0 && <button type="button" className="btn btn-outline" onClick={() => setSelectedId(queue[0].id)}>Back to oldest order</button>}
              </div>
              <p className={styles.viewNote}>View only — this doesn’t mark an order done.</p>
            </div>
          </article>

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
                      <span className={styles.paymentBadge}>Unpaid</span>
                    </div>
                    <p className={styles.received}><time dateTime={ticket.createdAt}>{receivedTime(ticket.createdAt)}</time> · {sourceLabels[ticket.source]}</p>
                    <ServiceBadge />
                    <DishLines ticket={ticket} compact />
                    <p className={styles.previewTotal}>Total <strong>{money(ticket.cart.totalCents)}</strong></p>
                    <p className={styles.fullId}>Full order ID: <code>{ticket.id}</code></p>
                    <button type="button" className="btn btn-outline" onClick={() => setSelectedId(ticket.id)} aria-label={`View order ${ticket.id}`}>View order</button>
                  </article>
                ))}
              </div>
            ) : <p className={styles.noNext}>That’s the only order in the queue for now.</p>}
            {additionalCount > 0 && <p className={styles.moreOrders}>+ {additionalCount} more {additionalCount === 1 ? "order" : "orders"} in queue</p>}
            <p className={styles.queueFooter}>{queue.length} {queue.length === 1 ? "order" : "orders"} in total · All orders stay in the queue until completion is available.</p>
          </section>
        </>
      )}
    </div>
  );
}
