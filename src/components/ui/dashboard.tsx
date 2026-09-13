"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, createApiClient } from "@/shared/api-client";
import type { Menu, Ticket } from "@/shared/contracts";
import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";
import { getStaffAccessToken } from "./staff-access";
import styles from "./workspace.module.css";

const api = createApiClient();
const money = (n: number) => new Intl.NumberFormat('en-SG', { style:'currency',currency:'SGD' }).format(n/100);
const day = (date: Date) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function Dashboard({ restaurantId }: { restaurantId: string }) {
  const [data, setData] = useState<{ menu:Menu|null; orders:Ticket[] } | null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(true);
  const [panel,setPanel] = useState<'assistant'|'payments'>('assistant');
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async (active: () => boolean = () => true) => {
    try {
      const token = await getStaffAccessToken();
      const [menu,kitchen] = await Promise.all([api.readMenu(restaurantId).catch(e => { if(e instanceof ApiError && e.status===404)return null; throw e; }),api.kitchen(restaurantId,token)]);
      if (menu && menu.restaurantId !== restaurantId || kitchen.orders.some(ticket => ticket.cart.restaurantId !== restaurantId)) throw new Error("The summary does not match this stall.");
      if (active()) { setData({menu,orders:kitchen.orders}); setError(""); }
    } catch (e) { if (!active()) return; setError(e instanceof ApiError && e.status===401 ? "Please sign in again to open your stall." : "We couldn’t refresh your stall summary. Please try again."); }
    finally { if (active()) setBusy(false); }
  },[restaurantId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(() => active); }); return () => { active = false; }; },[load]);
  const today = day(new Date());
  const orders = data?.orders.filter(order=>day(new Date(order.createdAt))===today) ?? [];
  const query = `?restaurantId=${restaurantId}`;
  function open(which:'assistant'|'payments') { setPanel(which); dialog.current?.showModal(); }
  return <>
    <div className={styles.dashboardHead}><div><p className="eyebrow">Your stall</p><h1>Dashboard</h1><p className="muted">{data?.menu?.name || (restaurantId===DEMO_RESTAURANT_ID ? 'Jiak Simi demo stall' : 'Your stall workspace')}</p></div><Link className="btn btn-teal" href={`/kitchen${query}`}>Open cook mode →</Link></div>
    {busy && <p className="notice" role="status">Getting your latest menu and orders…</p>}
    {error && <div className="notice notice-error" role="alert"><p>{error}{data ? ' The figures below are from the last successful refresh.' : ''}</p><div className="actions"><button className="btn btn-outline" disabled={busy} onClick={()=>{ setBusy(true); void load(); }}>Try again</button><Link className="btn btn-outline" href="/login">Log in</Link></div></div>}
    <section className={styles.metrics} aria-label="Stall summary">
      <article className="card"><p>Orders received today</p><strong>{data ? orders.length : '—'}</strong><small>Singapore time</small></article>
      <article className="card"><p>Value of these orders</p><strong>{data ? money(orders.reduce((n,o)=>n+o.cart.totalCents,0)) : '—'}</strong><small>Unpaid · collect at stall</small></article>
      <article className="card"><p>Dishes available</p><strong>{data?.menu ? data.menu.dishes.filter(d=>d.available).length : data ? 0 : '—'}</strong><small>{data?.menu ? `Published menu · Version ${data.menu.version}` : 'Publish your menu to get started'}</small></article>
    </section>
    <div className={styles.dashboardGrid}>
      <section className="card"><h2>Your menu</h2><Link className="btn btn-primary" href={`/onboarding${query}`}>{data?.menu ? 'Review my menu' : 'Set up my menu'} →</Link></section>
      <section className="card"><h2>Your customer menu & QR</h2><p>Share your menu or print its QR.</p><Link className="btn btn-outline" href={`/storefront${query}`}>View menu & QR →</Link></section>
      <section className="card"><p className="eyebrow">Chat assistant</p><h2>More ways to order</h2><p>Chat setup coming soon.</p><button className="btn btn-primary" onClick={()=>open('assistant')}>Set up assistant</button></section>
      <section className="card"><p className="eyebrow">Payments · Demo only</p><h2>Payments</h2><p>Collect payment at the stall.</p><button className="btn btn-primary" onClick={()=>open('payments')}>View payment setup</button></section>
    </div>
    <details className={styles.stallSelector}><summary>Open another assigned stall</summary><form action="/"><label className="field">Stall ID<input name="restaurantId" required defaultValue={restaurantId} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" /></label><p className="muted">Use an assigned stall ID.</p><button className="btn btn-outline">Open stall</button></form></details>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="setup-title"><h2 id="setup-title">{panel==='assistant' ? 'Your assistant setup' : 'Payment setup'}</h2><p>{panel==='assistant' ? 'Chat setup is coming soon. Use your menu link or QR.' : 'Demo only. Collect payment at the stall; orders stay unpaid.'}</p><button className="btn btn-teal" onClick={()=>dialog.current?.close()}>Got it</button></dialog>
  </>;
}
