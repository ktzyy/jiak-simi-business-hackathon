"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { ApiError, createApiClient } from "@/shared/api-client";
import { CartRequestSchema, MenuSchema, type CartRequest, type Menu, type Quote, type Ticket } from "@/shared/contracts";
import type { StallDetails } from "@/shared/stall-details";
import { formatPublishedHours, cartProblems, definitelyNotSent, money, previewQuote, quoteMatchesCart, receiptMatches, savedOrderSchema, type PendingOrder, type SavedOrder } from "./order-state";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";
import { OrderReview } from "./order-review";
import { DemoDishPhoto } from "./demo-dish-photo";
import styles from "./ordering.module.css";

type Message = { kind: "info" | "error" | "notSent" | "unknown"; text: string };
type DishSheet = { dishId: string; index?: number };
const errorText = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";

function BottomSheet({ children, onClose, preview, label }: { children: ReactNode; onClose?: () => void; preview: boolean; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = ref.current;
    element?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeRef.current) { event.preventDefault(); closeRef.current(); }
      if (event.key === "Tab" && element) {
        const items = [...element.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]')].filter(item => item.getClientRects().length > 0);
        const first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); element.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, []);
  return <div className={`${styles.backdrop} ${preview ? styles.previewBackdrop : ""}`}>
    <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={label} ref={ref} tabIndex={-1}>
      <div className={styles.sheetHandle} />
      {onClose && <button className={styles.close} aria-label="Close" onClick={onClose}>×</button>}
      {children}
    </div>
  </div>;
}

export function CustomerCart({ restaurantId, previewMenu, previewHours }: { restaurantId: string; previewMenu?: Menu; previewHours?: string }) {
  const preview = previewMenu !== undefined;
  const api = useMemo(() => createApiClient(), []);
  const storageKey = `jiak-order-v1:${restaurantId}`;
  const [menu, setMenu] = useState<Menu | null>(previewMenu ?? null);
  const [publishedDetails, setPublishedDetails] = useState<StallDetails | null>(null);
  const [fulfillmentType, setFulfillmentType] = useState<CartRequest["fulfillmentType"] | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [ready, setReady] = useState(preview);
  const [boot, setBoot] = useState(0);
  const [lines, setLines] = useState<CartRequest["lines"]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<DishSheet | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pending, setPending] = useState<PendingOrder | null>(null);
  const [receipt, setReceipt] = useState<Ticket | null>(null);
  const [previewReceipt, setPreviewReceipt] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestEpoch = useRef(0);

  useEffect(() => {
    let active = true;
    requestEpoch.current += 1;
    async function start() {
      busyRef.current = false; setBusy(false);
      setLoading(true); setReady(preview); setPublishedDetails(null); setFulfillmentType(null); setMenu(previewMenu ?? null); setLines([]); setQuote(null); setPending(null); setReceipt(null); setPreviewReceipt(null); setStorageError(null); setMessage(null); setCartOpen(false); setSheet(null); setSheetError(null);
      if (previewMenu) {
        const parsed = MenuSchema.safeParse(previewMenu);
        if (parsed.success) setMenu(parsed.data);
        else { setMenu(null); setMessage({ kind: "error", text: "Please finish checking the menu before previewing it." }); }
        setLoading(false); return;
      }
      let saved: SavedOrder | null = null;
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          saved = savedOrderSchema.parse(JSON.parse(raw));
          if (saved.cart.restaurantId !== restaurantId) throw new Error("Wrong stall in saved order.");
          setLines(saved.cart.lines); setFulfillmentType(saved.cart.fulfillmentType); setQuote(saved.quote);
          if (saved.kind === "receipt") setReceipt(saved.ticket);
          else { setPending(saved); setCartOpen(true); setMessage({ kind: "unknown", text: "We found an order waiting for confirmation. It may already be with the stall. Check again using the same order below." }); }
        } else {
          // Fail before ordering if this browser cannot preserve a submission across reloads.
          sessionStorage.setItem(`${storageKey}:check`, "ok");
          sessionStorage.removeItem(`${storageKey}:check`);
        }
      } catch {
        if (active) { setStorageError("We couldn’t safely read your saved order. Please check with the stall before ordering again. Keep this tab open."); setLoading(false); }
        return;
      }
      try {
        const published = await api.readPublishedStall(restaurantId);
        const current = published.menu;
        if (!active) return;
        if (current.restaurantId !== restaurantId) throw new Error("This menu belongs to another stall. Please scan the QR again.");
        setMenu(current);
        if (published.details && published.details.restaurantId !== restaurantId) throw new Error("These hours belong to another stall.");
        setPublishedDetails(published.details);
        // Never replace a guest capability while an earlier order may have been received.
        if (!saved) { await api.startGuest(restaurantId); if (active) setReady(true); }
      } catch (error) { if (active) setMessage(saved?.kind === "pending" ? { kind: "unknown", text: "Your saved order is still waiting for confirmation. Keep it unchanged and use the same order to check again." } : { kind: "error", text: errorText(error) }); }
      finally { if (active) setLoading(false); }
    }
    void start();
    return () => { active = false; requestEpoch.current += 1; };
  }, [api, boot, preview, previewMenu, restaurantId, storageKey]);

  function save(value: SavedOrder): boolean {
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); return true; }
    catch { setStorageError("This browser couldn’t save your order safely. Keep this tab open. Please check with the stall before starting another order."); return false; }
  }
  function clearSaved(): boolean {
    try { sessionStorage.removeItem(storageKey); return true; }
    catch { setStorageError("We couldn’t clear the saved order. Keep this tab open and check with the stall before ordering again."); return false; }
  }
  const locked = pending !== null || busy || storageError !== null;
  const problems = menu ? cartProblems(menu, lines) : [];
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const estimate = menu && fulfillmentType && lines.length && !problems.length ? previewQuote(menu, lines, fulfillmentType).totalCents : null;
  const dish = sheet && menu?.dishes.find(item => item.id === sheet.dishId);
  const sheetProblems = dish && menu ? cartProblems(menu, [{ dishId: dish.id, quantity, optionIds }]) : [];
  const sheetPrice = dish ? (dish.priceCents + dish.modifierGroups.flatMap(group => group.options).filter(option => optionIds.includes(option.id)).reduce((sum, option) => sum + option.priceDeltaCents, 0)) * quantity : 0;

  function openDish(dishId: string, index?: number) {
    if (locked) return;
    const existing = index !== undefined ? lines[index] : null;
    setSheet({ dishId, index }); setQuantity(existing?.quantity ?? 1); setOptionIds(existing?.optionIds ?? []); setSheetError(null); setCartOpen(false);
  }
  function putLine() {
    if (!menu || !dish || !sheet || locked) return;
    if (sheetProblems.length) { setSheetError(sheetProblems[0]); return; }
    if (sheet.index === undefined && lines.length >= 50) { setSheetError("Your cart has 50 items. Please send this order before adding more."); return; }
    const next = { dishId: dish.id, quantity, optionIds: [...optionIds] };
    setLines(old => sheet.index === undefined ? [...old, next] : old.map((line, index) => index === sheet.index ? next : line));
    setQuote(null); setSheet(null); setMessage({ kind: "info", text: `${dish.name} ${sheet.index === undefined ? "added to" : "updated in"} your order.` });
  }
  async function review() {
    if (!menu || !fulfillmentType || !lines.length || locked || !ready || busyRef.current) return;
    if (problems.length) { setMessage({ kind: "error", text: problems[0] }); return; }
    const cart = CartRequestSchema.parse({ restaurantId, menuId: menu.id, menuVersion: menu.version, fulfillmentType, lines });
    const epoch = requestEpoch.current;
    busyRef.current = true; setBusy(true); setMessage(null);
    try {
      const priced = preview ? previewQuote(menu, lines, fulfillmentType) : await api.quote(cart);
      if (epoch !== requestEpoch.current) return;
      if (!quoteMatchesCart(cart, priced)) throw new Error("The price check didn’t match your order. Please try again.");
      setQuote(priced);
    } catch (error) {
      if (epoch !== requestEpoch.current) return;
      setQuote(null); setMessage({ kind: "notSent", text: `${errorText(error)} Your order has not been sent.` });
      if (error instanceof ApiError && ["INVALID_SESSION", "SESSION_EXPIRED"].includes(error.code)) setReady(false);
    } finally { if (epoch === requestEpoch.current) { setBusy(false); busyRef.current = false; } }
  }
  async function submit() {
    if (!quote || busyRef.current || (storageError && !pending)) return;
    if (preview) { setPreviewReceipt(quote); setCartOpen(false); setLines([]); setQuote(null); return; }
    const retry = pending !== null;
    const epoch = requestEpoch.current;
    let record = pending;
    if (!record) {
      if (!menu || !fulfillmentType || !ready) return;
      const cart = CartRequestSchema.parse({ restaurantId, menuId: menu.id, menuVersion: menu.version, fulfillmentType, lines });
      if (!quoteMatchesCart(cart, quote)) { setMessage({ kind: "notSent", text: "Your order changed. Please check the total again. Nothing has been sent." }); setQuote(null); return; }
      try { record = { kind: "pending", key: crypto.randomUUID(), cart, quote }; }
      catch { setStorageError("This browser cannot safely identify your order. Please use a current browser on a secure connection. Nothing has been sent."); return; }
      if (!save(record)) return;
      setPending(record);
    }
    busyRef.current = true; setBusy(true); setMessage({ kind: "info", text: retry ? "Checking the same order with the stall…" : "Sending to the stall. Please keep this page open…" });
    try {
      const ticket = await api.submit({ cart: record.cart, reviewedTotalCents: record.quote.totalCents, confirmed: true }, record.key);
      // A navigation keeps the pre-saved pending record recoverable in its original stall.
      // Never render an old request's result into a newly opened customer screen.
      if (epoch !== requestEpoch.current) return;
      if (!receiptMatches(record.cart, record.quote, ticket)) throw new ApiError("INVALID_RESPONSE", "The receipt could not be matched to your order.", 200, false);
      save({ ...record, kind: "receipt", ticket });
      setReceipt(ticket); setPending(null); setCartOpen(false); setMessage(null);
    } catch (error) {
      if (epoch !== requestEpoch.current) return;
      if (!retry && definitelyNotSent(error)) {
        if (clearSaved()) { setPending(null); setQuote(null); }
        setMessage({ kind: "notSent", text: `${errorText(error)} Your order has not been sent.` });
        if (error instanceof ApiError && ["INVALID_SESSION", "SESSION_EXPIRED"].includes(error.code)) setReady(false);
      } else {
        setMessage({ kind: "unknown", text: error instanceof ApiError && ["INVALID_SESSION", "SESSION_EXPIRED", "IDEMPOTENCY_CONFLICT"].includes(error.code)
          ? "We can’t safely confirm this order in the current session. It may already be with the stall. Please check with them before ordering again."
          : "We haven’t received confirmation yet. Your order may already be with the stall. Keep it unchanged and check again with the same order." });
      }
    } finally { if (epoch === requestEpoch.current) { busyRef.current = false; setBusy(false); } }
  }
  async function refresh() {
    if (locked || busyRef.current || preview) return;
    const epoch = requestEpoch.current;
    busyRef.current = true; setBusy(true); setQuote(null);
    try { const published = await api.readPublishedStall(restaurantId); const next = published.menu; if (epoch !== requestEpoch.current) return; if (next.restaurantId !== restaurantId) throw new Error("Please scan this stall’s QR again."); setMenu(next); if (published.details && published.details.restaurantId !== restaurantId) throw new Error("These hours belong to another stall."); setPublishedDetails(published.details); await api.startGuest(restaurantId); if (epoch !== requestEpoch.current) return; setReady(true); setMessage({ kind: "info", text: "The menu is up to date. Please check your items and total again." }); }
    catch (error) { if (epoch === requestEpoch.current) setMessage({ kind: "notSent", text: `${errorText(error)} No order has been sent.` }); }
    finally { if (epoch === requestEpoch.current) { busyRef.current = false; setBusy(false); } }
  }
  function anotherOrder() {
    if (preview) { setPreviewReceipt(null); return; }
    if (storageError || !clearSaved()) return;
    setBoot(value => value + 1);
  }

  const currentReceipt = receipt?.cart ?? previewReceipt;
  if (currentReceipt) return <div className={`${styles.customer} ${preview ? styles.preview : ""}`}>
    <div className={styles.receipt}>
      <div className={styles.receiptMark} aria-hidden="true">✓</div>
      <p className="eyebrow">{previewReceipt ? "Preview only" : "Order received"}</p>
      <h1>{previewReceipt ? "That’s how ordering works." : "Your order is with the stall."}</h1>
      <p>{currentReceipt.fulfillmentType === "dine_in" ? "Dine-in" : currentReceipt.fulfillmentType === "takeaway" ? "Takeaway" : "Dining choice not recorded"}</p>
      <p>{previewReceipt ? "This is a practice order. Nothing was sent and no payment was taken." : "Sit tight. Show this confirmation at the stall when collecting your food."}</p>
      {receipt && <><div className={styles.receivedBadge}>Received by the stall</div><p className={styles.muted}>Received {new Date(receipt.createdAt).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" })} · Payment due at stall</p><small className={styles.reference}>Order reference: {receipt.id}</small></>}
      {currentReceipt.lines.map((line, i) => <div className={styles.reviewLine} key={i}><div><strong>{line.quantity} × {line.name}</strong>{line.options.map(option => <small key={option.id}>{option.name}</small>)}</div><span>{money(line.lineTotalCents)}</span></div>)}
      <div className={styles.total}><strong>Total</strong><strong>{money(currentReceipt.totalCents)}</strong></div>
      {storageError && <div className="notice" role="alert">Your order was received, but we couldn’t save the receipt in this browser. Keep this confirmation open. {storageError}</div>}
      <button className={`btn btn-teal ${styles.full}`} disabled={!!storageError} onClick={anotherOrder}>{preview ? "Try the menu again" : "Start a new order"}</button>
    </div>
  </div>;

  return <div className={`${styles.customer} ${preview ? styles.preview : ""}`}>
    {preview && <div className={styles.previewLabel}>CUSTOMER PREVIEW · NO ORDERS SENT</div>}
    <header className={styles.header}>
      <Link href="/" className={styles.brand}><Image src="/brand/jiak-simi.png" alt="Jiak Simi" width={144} height={35} style={{ width: 144, height: "auto" }} /></Link>
      {restaurantId === DEMO_RESTAURANT_ID && !preview && <nav className={styles.demoActions} aria-label="Try the ordering demo">
        <a className="btn btn-teal" href="https://t.me/blackcharsiewbot" target="_blank" rel="noopener noreferrer">Order on Telegram ↗</a>
        <Link className="btn btn-outline" href="/voice-test">Speak with GPT Live</Link>
        <Link className="btn btn-outline" href={`/kitchen?restaurantId=${restaurantId}`}>Cook mode</Link>
        <p>Speak, message, or order below. Then open Cook mode to see your order arrive.</p>
      </nav>}
      <p className="eyebrow">Good food, less waiting</p>
      <h1>{menu?.name ?? "Your stall’s menu"}</h1>
      {publishedDetails ? <details className={styles.hours}><summary>Opening hours · Singapore time</summary>{formatPublishedHours(publishedDetails).map(day => <p key={day}>{day}</p>)}</details> : <p className={styles.hours}>{previewHours || "Opening hours · Please check with the stall"}</p>}
      <div className={styles.dining} role="group" aria-label="Choose dine-in or takeaway">
        {(["dine_in", "takeaway"] as const).map(mode => <button key={mode} type="button" aria-pressed={fulfillmentType === mode} disabled={locked} onClick={() => { if (locked || busyRef.current) return; setFulfillmentType(mode); setQuote(null); setMessage(null); }}>{mode === "dine_in" ? "Dine-in" : "Takeaway"}</button>)}
      </div>
    </header>
    <div className={styles.menuContent}>
      {restaurantId === DEMO_RESTAURANT_ID && !preview && <details className={styles.sourcePhoto}>
        <summary>View menu photo · original source</summary>
        <Image src="/demo/menu-photo.jpg" alt="Original roast-meat menu photograph, including the dishes and additional ingredients panel" width={4032} height={3024} unoptimized />
        <p>Photographed printed menu. Reviewed prices and options below are authoritative; covered prices were confirmed separately for this demo.</p>
        <a href="/demo/menu-photo.jpg" target="_blank" rel="noopener noreferrer">Open full menu photo ↗</a>
      </details>}
      {storageError && <div className={`${styles.alert} ${styles.error}`} role="alert"><strong>Saved order needs checking</strong><p>{storageError}</p><button className="btn btn-outline" onClick={() => setBoot(value => value + 1)}>Try loading again</button></div>}
      {message && !cartOpen && <div className={`${styles.alert} ${message.kind === "info" ? "" : styles.error}`} role={message.kind === "info" ? "status" : "alert"}><strong>{message.kind === "notSent" ? "Not sent" : message.kind === "unknown" ? "Waiting for confirmation" : message.kind === "error" ? "Please check" : ""}</strong><p>{message.text}</p></div>}
      {loading && <div role="status" className={styles.loading}><span className={styles.loader} />Getting the menu ready…</div>}
      {!loading && !menu && !storageError && <div className={styles.empty}><h2>The menu isn’t ready just yet.</h2><p>Please try again, or ask the stall for help.</p><button className="btn btn-teal" disabled={!!pending} onClick={() => setBoot(value => value + 1)}>Try again</button></div>}
      {menu && <><div className={styles.sectionHeading}><h2>What would you like?</h2><span>{menu.dishes.length} dishes</span></div>
        <p className={styles.muted}>Pick a dish, add your extras, then check your order.</p>
        <div className={styles.dishes}>{menu.dishes.map(item => <article className={`${styles.dish} ${!item.available ? styles.soldOut : ""}`} key={item.id}>
          <DemoDishPhoto restaurantId={menu.restaurantId} dish={item} />
          <div className={styles.dishBody}><h3>{item.name}</h3><strong className={styles.price}>{money(item.priceCents)}</strong>{item.modifierGroups.length > 0 && <p className={styles.modifierHint}>Make it yours · extras available</p>}
            <button className="btn btn-primary" disabled={!item.available || locked || !ready} onClick={() => openDish(item.id)}>{item.available ? "Add to order +" : "Sold out"}</button>
          </div>
        </article>)}</div>
        {!preview && !pending && <button className={`btn btn-outline ${styles.full}`} disabled={busy || !!storageError} onClick={() => void refresh()}>{busy ? "Checking…" : ready ? "Refresh menu" : "Reconnect to order"}</button>}
      </>}
    </div>
    {(count > 0 || pending) && <div className={styles.cartBar}><button className="btn btn-teal" onClick={() => { setCartOpen(true); setSheet(null); }}><span>{pending ? "Check pending order" : `View order · ${count} ${count === 1 ? "item" : "items"}`}</span><strong>{money(pending?.quote.totalCents ?? quote?.totalCents ?? estimate ?? 0)}</strong></button></div>}

    {dish && sheet && <BottomSheet preview={preview} label={`Choose options for ${dish.name}`} onClose={() => setSheet(null)}>
      <p className="eyebrow">Make it yours</p><h2>{dish.name}</h2><p className={styles.sheetPrice}>{money(dish.priceCents)}</p>
      {dish.modifierGroups.length === 0 && <p className={styles.muted}>No extra options for this dish. How many would you like?</p>}
      {dish.modifierGroups.map(group => {
        const selected = group.options.filter(option => optionIds.includes(option.id)).length;
        return <fieldset className={styles.options} key={group.id}><legend>{group.name}</legend><p>{group.minSelections > 0 ? "Required" : "Optional"} · {group.minSelections === group.maxSelections ? `Choose ${group.minSelections}` : `Choose ${group.minSelections}–${group.maxSelections}`}</p>
          {group.options.map(option => <label key={option.id}><input type="checkbox" checked={optionIds.includes(option.id)} disabled={!optionIds.includes(option.id) && selected >= group.maxSelections} onChange={event => { setOptionIds(old => event.target.checked ? [...old, option.id] : old.filter(id => id !== option.id)); setSheetError(null); }} /><span>{option.name}</span><strong>{option.priceDeltaCents === 0 ? "Included" : `${option.priceDeltaCents > 0 ? "+" : "−"}${money(Math.abs(option.priceDeltaCents))}`}</strong></label>)}
        </fieldset>;
      })}
      <div className={styles.quantity}><strong>Quantity</strong><div><button aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity(value => value - 1)}>−</button><output aria-live="polite">{quantity}</output><button aria-label="Increase quantity" disabled={quantity >= 20} onClick={() => setQuantity(value => value + 1)}>+</button></div></div>
      {sheetError && <p className={styles.validation} role="alert">{sheetError}</p>}
      <button className={`btn btn-primary ${styles.full}`} onClick={putLine}>{sheet.index === undefined ? "Add to order" : "Save changes"} · {money(sheetPrice)}</button>
    </BottomSheet>}

    {cartOpen && <BottomSheet preview={preview} label="Your order" onClose={busy ? undefined : () => setCartOpen(false)}>
      {message && <div className={`${styles.alert} ${message.kind === "info" ? "" : styles.error}`} role={message.kind === "info" ? "status" : "alert"}><strong>{message.kind === "notSent" ? "Not sent" : message.kind === "unknown" ? "Waiting for confirmation" : ""}</strong><p>{message.text}</p></div>}
      {storageError && <p className={styles.validation} role="alert">{storageError}</p>}
      {quote ? <OrderReview quote={quote} busy={busy} locked={!!pending} preview={preview} onConfirm={() => void submit()} onEdit={() => setQuote(null)} /> : <>
        <p className="eyebrow">A good meal starts here</p><h2>Your order</h2>
        <div className={styles.dining} role="group" aria-label="Choose dine-in or takeaway for this cart">{(["dine_in", "takeaway"] as const).map(mode => <button key={mode} type="button" aria-pressed={fulfillmentType === mode} disabled={locked} onClick={() => { if (locked || busyRef.current) return; setFulfillmentType(mode); setQuote(null); }}>{mode === "dine_in" ? "Dine-in" : "Takeaway"}</button>)}</div>
        {!fulfillmentType && <p className={styles.validation}>Choose dine-in or takeaway to continue.</p>}
        {!lines.length && <p>Your order is empty. Pick something nice from the menu.</p>}
        {lines.map((line, index) => {
          const item = menu?.dishes.find(value => value.id === line.dishId);
          const options = item?.modifierGroups.flatMap(group => group.options).filter(option => line.optionIds.includes(option.id)) ?? [];
          return <div className={styles.cartLine} key={index}><strong>{line.quantity} × {item?.name ?? "Item no longer on the menu"}</strong>{options.map(option => <small key={option.id}>{option.name}</small>)}<div className={styles.cartActions}><button className="btn btn-outline" disabled={locked || !item?.available} onClick={() => openDish(line.dishId, index)}>Edit</button><button className={styles.remove} disabled={locked} onClick={() => { setLines(old => old.filter((_, i) => i !== index)); setQuote(null); }}>Remove</button></div></div>;
        })}
        {problems.length > 0 && <div className={styles.validation} role="alert"><strong>A quick check, please</strong><ul>{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></div>}
        {estimate !== null && <div className={styles.total}><span>Estimated total</span><strong>{money(estimate)}</strong></div>}
        <p className={styles.muted}>We’ll check the latest prices before you confirm.</p>
        <button className={`btn btn-primary ${styles.full}`} disabled={!fulfillmentType || !lines.length || locked || !ready || problems.length > 0} onClick={() => void review()}>{busy ? "Checking the total…" : "Check order & total"}</button>
        {!preview && <button className={`btn btn-outline ${styles.full}`} disabled={locked} onClick={() => void refresh()}>Refresh menu & reconnect</button>}
      </>}
      {pending && <small className={styles.reference}>Keep this reference: {pending.key}</small>}
    </BottomSheet>}
  </div>;
}
