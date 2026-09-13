"use client";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { ApiError, createApiClient } from "@/shared/api-client";
import type { Menu } from "@/shared/contracts";
import { qrcodegen } from "./vendor/qrcodegen";
import styles from "./storefront.module.css";

const api = createApiClient();
const subscribe = () => () => {};
export function createQrSvg(url: string) {
  const qr = qrcodegen.QrCode.encodeText(url, qrcodegen.QrCode.Ecc.MEDIUM);
  const size = qr.size + 8;
  const path: string[] = [];
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
    if (qr.getModule(x, y)) path.push(`M${x+4},${y+4}h1v1h-1z`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="512" height="512"><rect width="100%" height="100%" fill="white"/><path d="${path.join("")}" fill="black" shape-rendering="crispEdges"/></svg>`;
}

export function QrPanel({ restaurantId }: { restaurantId: string }) {
  const origin = useSyncExternalStore(subscribe, () => window.location.origin, () => "");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const load = useCallback(async (active: () => boolean = () => true) => {
    try { const result = await api.readMenu(restaurantId); if (result.restaurantId !== restaurantId) throw new Error("Menu does not match this stall."); if (active()) { setMenu(result); setError(""); } }
    catch (e) { if (!active()) return; setMenu(null); setError(e instanceof ApiError && e.status === 404 ? "There isn’t a published menu yet. Review your menu, then publish it to get your QR." : "We couldn’t check your published menu. Please try again."); }
    finally { if (active()) setBusy(false); }
  }, [restaurantId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(() => active); }); return () => { active = false; }; }, [load]);
  const url = origin ? `${origin}/order/${encodeURIComponent(restaurantId)}` : "";
  const svg = useMemo(() => { try { return url ? createQrSvg(url) : ""; } catch { return ""; } }, [url]);
  const local = origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("[::1]");
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied("Menu link copied."); }
    catch { setCopied("Couldn’t copy automatically. Select the link below and copy it."); }
  }
  return <div className={styles.storefront}>
    <div><p className="eyebrow">Menu & QR</p><h1>Share your menu</h1><p className="muted">Customers scan this QR to order.</p></div>
    {busy && <p className="notice" role="status">Checking your published menu…</p>}
    {error && <div className="notice notice-error" role="alert"><p>{error}</p><div className="actions"><button className="btn btn-outline" disabled={busy} onClick={() => { setBusy(true); void load(); }}>Try again</button><Link className="btn btn-teal" href={`/onboarding?restaurantId=${restaurantId}`}>Review my menu</Link></div></div>}
    {menu && !busy && <>
      <section className={`card ${styles.qrCard}`} aria-label="Published menu QR">
        <p className="eyebrow">Published menu</p><h2>{menu.name}</h2>
        {svg ? <Image unoptimized className={styles.qr} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={`QR code for ${menu.name}`} width={280} height={280} /> : <p role="alert">We couldn’t prepare the QR. Use the menu link below.</p>}
        <strong className={styles.scan}>Scan. Choose. Shiok.</strong><p>{menu.dishes.filter(d => d.available).length} dishes available</p>
        <div className="actions">
          {svg && <a className="btn btn-teal" href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} download="jiak-simi-menu-qr.svg">Download QR</a>}
          <button className="btn btn-outline" onClick={copy}>Copy menu link</button>
        </div>
        <p role="status" className="muted">{copied}</p><a className={styles.url} href={url} target="_blank" rel="noreferrer">{url}</a>
      </section>
      {local && <p className="notice">Local preview. Download a new QR after publishing the site.</p>}
      <div className="actions"><a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">Open customer menu ↗</a><Link className="btn btn-outline" href={`/onboarding?restaurantId=${restaurantId}`}>Edit menu</Link><Link className="btn btn-outline" href={`/kitchen?restaurantId=${restaurantId}`}>Open cook mode</Link></div>
    </>}
  </div>;
}
