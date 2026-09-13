import type { Quote } from "@/shared/contracts";
import { money } from "./order-state";
import styles from "./ordering.module.css";

export function OrderReview({ quote, busy, locked, preview, onConfirm, onEdit }: {
  quote: Quote; busy: boolean; locked: boolean; preview: boolean; onConfirm: () => void; onEdit: () => void;
}) {
  return <section aria-label="Review your order">
    <p className="eyebrow">{preview ? "Preview only" : "One last check"}</p>
    <h2>Your order, all correct?</h2>
    <p><strong>{quote.fulfillmentType === "dine_in" ? "Dine-in" : "Takeaway"}</strong></p>
    <p className={styles.muted}>{locked ? "Keep these details as they are while we check your order." : "Check your dishes and extras before sending to the stall."}</p>
    <div className={styles.reviewLines}>{quote.lines.map((line, i) => <div className={styles.reviewLine} key={`${line.dishId}-${i}`}>
      <div><strong>{line.quantity} × {line.name}</strong>{line.options.map(option => <small key={option.id}>{option.name} {option.priceDeltaCents !== 0 && `(${option.priceDeltaCents > 0 ? "+" : "−"}${money(Math.abs(option.priceDeltaCents))})`}</small>)}</div>
      <strong>{money(line.lineTotalCents)}</strong>
    </div>)}</div>
    <div className={styles.total}><strong>Total</strong><strong>{money(quote.totalCents)}</strong></div>
    <p className={styles.muted}>No online payment is taken here. Please pay at the stall.</p>
    <button className={`btn btn-primary ${styles.full}`} disabled={busy} onClick={onConfirm}>{busy ? "Sending your order…" : locked ? "Check again with the same order" : preview ? "Try the order confirmation" : `Confirm & send order · ${money(quote.totalCents)}`}</button>
    {!locked && <button className={`btn btn-outline ${styles.full}`} disabled={busy} onClick={onEdit}>Make a change</button>}
  </section>;
}
