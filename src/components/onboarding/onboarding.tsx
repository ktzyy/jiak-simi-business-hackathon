"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError, createApiClient } from "@/shared/api-client";
import { MenuSchema, type Menu } from "@/shared/contracts";
import type { StallDetails as SavedStallDetails } from "@/shared/stall-details";
import { detailsInput, editorHours, sameDetailsInput, PendingPublicationSchema, matchesPublication } from "./hours-state";
import type { ExtractedMenuDraft } from "@/shared/extraction";
import { OCR_DRAFT_FIXTURE } from "@/shared/ocr-fixtures";
import { PageShell } from "@/components/ui/page-shell";
import { getStaffAccessToken } from "@/components/ui/staff-access";
import { CustomerCart } from "@/components/ordering/customer-cart";
import { StallDetails } from "./stall-details";
import { MenuReview } from "./menu-review";
import { DAYS, dishProblem, draftDishes, emptyHours, existingDishes, hoursProblem, hoursSummary, newDish, reviewedMenu, type DishEdit, type SourceDecision } from "./review-state";
import { cleanDemoDishes, demoMenu } from "./demo-draft";
import { PUBLIC_DEMO_RESTAURANT_ID } from "@/shared/public-demo";
import s from "./onboarding.module.css";

const api = createApiClient();
function errorText(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Your edits are still here."; }
async function readCurrent(restaurantId: string): Promise<Menu | null> {
  try { const menu = await api.readMenu(restaurantId); if (menu.restaurantId !== restaurantId) throw new Error("The menu does not match this stall. Please open your assigned stall link again."); return menu; }
  catch (error) { if (error instanceof ApiError && error.status === 404 && ["MENU_NOT_FOUND", "UNKNOWN_MENU"].includes(error.code)) return null; throw error; }
}
function sameMenu(a: Menu, b: Menu) { return JSON.stringify(MenuSchema.parse(a)) === JSON.stringify(MenuSchema.parse(b)); }
const needsReconciliation = (error: unknown) => !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.code === "INVALID_RESPONSE";

export function Onboarding({ restaurantId }: { restaurantId: string }) {
  const quickDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "true" && restaurantId === PUBLIC_DEMO_RESTAURANT_ID;
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [hours, setHours] = useState(() => DAYS.map(emptyHours));
  const [pageDetails, setPageDetails] = useState({ url: "", address: "", contact: "" });
  const [sameHours, setSameHours] = useState(false);
  const [savedDetails, setSavedDetails] = useState<SavedStallDetails | null>(null);
  const [previewDetails, setPreviewDetails] = useState<SavedStallDetails | null>(null);
  const [pendingDetails, setPendingDetails] = useState<SavedStallDetails | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExtractedMenuDraft | null>(null);
  const [dishes, setDishes] = useState<DishEdit[]>([]);
  const [sources, setSources] = useState<Record<string, SourceDecision>>({});
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [sample, setSample] = useState(false);
  const [current, setCurrent] = useState<Menu | null>(null);
  const [menuRead, setMenuRead] = useState<"loading" | "ready" | "error">("loading");
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<Menu | null>(null);
  const [published, setPublished] = useState<Menu | null>(null);
  const [pending, setPending] = useState<Menu | null>(null);
  const [conflict, setConflict] = useState(false);
  const [menuOnly, setMenuOnly] = useState(false);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorNode = useRef<HTMLDivElement>(null);
  const pendingKey = `jiak:onboarding:pending-menu:${restaurantId}`;

  useEffect(() => {
    let active = true;
    Promise.all([readCurrent(restaurantId), getStaffAccessToken().then(token => api.readStallDetails(restaurantId, token))]).then(([menu, response]) => {
      if (!active) return;
      setCurrent(menu); setMenuRead("ready"); setSavedDetails(response.details);
      setName(response.details?.name ?? menu?.name ?? "");
      if (response.details) { setHours(editorHours(response.details)); setSameHours(false); }
    }).catch(e => {
      if (!active) return;
      setMenuRead("error"); setError(`We couldn’t load the current menu. ${errorText(e)} You can work on your draft, but publication needs this check.`);
    }).finally(() => {
      if (!active) return;
      try {
        const saved = sessionStorage.getItem(pendingKey);
        if (saved) {
          const parsed = PendingPublicationSchema.safeParse(JSON.parse(saved));
          if (parsed.success && parsed.data.menu.restaurantId === restaurantId && parsed.data.details.restaurantId === restaurantId) {
            setPending(parsed.data.menu); setPendingDetails(parsed.data.details); setPreview(parsed.data.menu); setPreviewDetails(parsed.data.details); setDishes(existingDishes(parsed.data.menu)); setName(parsed.data.details.name); setHours(editorHours(parsed.data.details)); setSameHours(false); setStep(3);
            setNotice("A previous publish needs checking. Keep this page open and check its status before making another version.");
          } else throw new Error("The saved publication record could not be verified.");
        }
      } catch {
        setStorageBlocked(true);
        setError("We can’t safely read a previous publication record from this browser. You can work on a draft, but publishing is paused to protect that earlier attempt. Restore browser storage access and reload to check again; don’t clear the record until the previous publication has been verified.");
      }
    });
    return () => { active = false; };
  }, [restaurantId, pendingKey]);

  useEffect(() => {
    return () => { if (photoUrl) URL.revokeObjectURL(photoUrl); };
  }, [photoUrl]);

  useEffect(() => { if (error) errorNode.current?.focus(); }, [error]);
  useEffect(() => { heading.current?.focus(); }, [step]);

  function stepOneProblem() {
    if (!name.trim() || name.trim().length > 120) return "Add your stall name before continuing.";
    return hoursProblem(hours, sameHours);
  }
  function mayContinue() {
    const problem = stepOneProblem();
    if (problem) { setError(problem); return false; }
    setError(""); return true;
  }
  function loadDraft(next: ExtractedMenuDraft | null, kind: "sample" | "manual" | "current" | "photo") {
    const original = next ? draftDishes(next) : kind === "current" && current ? existingDishes(current) : [newDish()];
    const readable = quickDemo && next ? original.filter(dish => {
      const item = next.items.find(item => item.id === dish.draftItemId);
      const source = next.sourceEntries?.find(source => source.id === item?.sourceEntryId);
      return !source || source.currency === "SGD" && !source.priceUncertain;
    }) : original;
    const cleaned = quickDemo && kind !== "manual" ? cleanDemoDishes(readable).dishes : readable;
    setDraft(next); setDishes(cleaned);
    setSources({}); setIssues({}); setSample(kind === "sample"); setPreview(null); setError("");
    setNotice(quickDemo && original.length !== cleaned.length ? `${original.length - cleaned.length} unclear entries skipped. You can add them later.` : ""); setStep(2);
  }
  function selectPhoto(file: File | null) {
    setError("");
    if (file && (!file.size || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      setPhoto(null); setPhotoUrl(null); setError("Choose a JPEG, PNG or WebP photo, up to 5 MiB. Your phone may need to export HEIC as JPEG first."); return;
    }
    setPhoto(file); setPhotoUrl(file ? URL.createObjectURL(file) : null);
  }
  async function extract() {
    if (inFlight.current || !mayContinue()) return;
    if (!photo) { setError("Choose a clear menu photo first."); return; }
    inFlight.current = true; setBusy("extract");
    try { const token = await getStaffAccessToken(); const next = await api.extract(photo, restaurantId, token); loadDraft(next, "photo"); }
    catch (e) { setError(errorText(e)); }
    finally { inFlight.current = false; setBusy(""); }
  }
  function changeDish(id: string, patch: Partial<DishEdit>) {
    setDishes(old => old.map(d => d.id === id ? { ...d, ...patch, confirmed: false } : d));
    setSources(old => Object.fromEntries(Object.entries(old).map(([key, value]) => [key, value.dishIds.includes(id) ? { ...value, confirmed: false } : value])));
    setPreview(null); setError("");
  }
  function confirmDishes(ids: string[]) {
    const selected = dishes.filter(d => ids.includes(d.id));
    for (const dish of selected) { const problem = dishProblem(dish); if (problem) { setError(`${dish.name || "New dish"}: ${problem}`); return false; } }
    const nextDishes = dishes.map(d => ids.includes(d.id) ? { ...d, confirmed: true, reason: d.included ? "Checked this dish’s name, price, availability and modifier rules." : d.reason.trim() } : d);
    setDishes(nextDishes);
    setSources(old => {
      const next = { ...old };
      for (const dish of selected) {
        const item = draft?.items.find(i => i.id === dish.draftItemId);
        if (!item?.sourceEntryId) continue;
        const paired = nextDishes.filter(d => d.included && draft?.items.some(i => i.id === d.draftItemId && i.sourceEntryId === item.sourceEntryId));
        next[item.sourceEntryId] = { dishIds: paired.map(d => d.id), reason: dish.included ? "Confirmed the extracted dish and its original printed source together." : `Excluded this original entry: ${dish.reason.trim()}`, confirmed: true };
      }
      return next;
    });
    setError(""); return true;
  }
  function removeDish(id: string) {
    setDishes(old => old.filter(d => d.id !== id));
    setSources(old => Object.fromEntries(Object.entries(old).map(([key, value]) => [key, value.dishIds.includes(id) ? { ...value, dishIds: value.dishIds.filter(d => d !== id), confirmed: false } : value])));
    setPreview(null);
  }
  async function reloadDetails() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy("details"); setError("");
    try { const response = await api.readStallDetails(restaurantId, await getStaffAccessToken()); setSavedDetails(response.details); setName(response.details?.name ?? current?.name ?? ""); setHours(response.details ? editorHours(response.details) : DAYS.map(emptyHours)); setSameHours(false); setPreview(null); setPreviewDetails(null); setNotice("Saved name and hours loaded. Review them before preparing a new preview."); }
    catch (e) { setError(errorText(e)); } finally { inFlight.current = false; setBusy(""); }
  }
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy("refresh"); setError("");
    try { setCurrent(await readCurrent(restaurantId)); setMenuRead("ready"); setNotice("Current menu checked. Your draft edits are still here."); }
    catch (e) { setMenuRead("error"); setError(errorText(e)); }
    finally { inFlight.current = false; setBusy(""); }
  }
  async function preparePreview(candidateDishes = dishes) {
    if (inFlight.current) return;
    const problem = stepOneProblem();
    if (problem) { setStep(1); setError(problem); return; }
    inFlight.current = true; setBusy("preview"); setError("");
    try {
      const fresh = await readCurrent(restaurantId); setCurrent(fresh); setMenuRead("ready");
      const menuInput = { dishes: candidateDishes, id: fresh?.id ?? crypto.randomUUID(), restaurantId, version: (fresh?.version ?? 0) + 1, name };
      const menu = quickDemo ? demoMenu(menuInput) : reviewedMenu({ ...menuInput, draft, sources, issues });
      if (quickDemo) setDishes(cleanDemoDishes(candidateDishes).dishes);
      const input = detailsInput(name, hours, sameHours);
      const token = await getStaffAccessToken();
      let details = savedDetails;
      if (!details || !sameDetailsInput(input, details)) {
        details = (await api.saveStallDetails(restaurantId, { ...input, expectedVersion: details?.version ?? 0 }, token)).details;
        setSavedDetails(details);
      }
      setPreviewDetails(details); setPreview(menu); setMenuOnly(false); setNotice(""); setStep(3);
    } catch (e) { setError(errorText(e)); }
    finally { inFlight.current = false; setBusy(""); }
  }
  function remember(candidate: Menu, details: SavedStallDetails) {
    try {
      const prior = sessionStorage.getItem(pendingKey);
      if (prior) {
        const parsed = PendingPublicationSchema.safeParse(JSON.parse(prior));
        if (!parsed.success || !matchesPublication(parsed.data, { menu: candidate, details })) {
          setStorageBlocked(true);
          throw new Error("A different publication record needs checking first.");
        }
      }
      sessionStorage.setItem(pendingKey, JSON.stringify({ menu: candidate, details }));
    }
    catch { throw new Error("Your browser couldn’t keep a record of this publish attempt. Free up browser storage, then try again. Nothing was sent."); }
    setPending(candidate); setPendingDetails(details);
  }
  function finish(menu: Menu) {
    setCurrent(menu); setPublished(menu); setPending(null); setPendingDetails(null); setConflict(false); setNotice(""); setError("");
    try { sessionStorage.removeItem(pendingKey); } catch { /* Reconciliation can safely repeat on a stale saved candidate. */ }
  }
  async function checkCandidate(candidate: Menu, details: SavedStallDetails) {
    const published = await api.readPublishedStall(restaurantId);
    const latest = published.menu; setCurrent(latest); setMenuRead("ready");
    if (matchesPublication({ menu: candidate, details }, published)) { finish(latest); return "published"; }
    if (latest && (latest.id !== candidate.id || latest.version >= candidate.version)) {
      setConflict(true); setNotice("The live menu has changed and doesn’t match this draft. Review again before publishing a new version."); return "conflict";
    }
    setNotice("This version is not visible yet. You can check again, or retry this exact publish. We’ll keep the same version so it cannot create a duplicate publication.");
    return "waiting";
  }
  async function reconcile() {
    if (!pending || !pendingDetails || inFlight.current) return;
    inFlight.current = true; setBusy("reconcile"); setError("");
    try { await checkCandidate(pending, pendingDetails); }
    catch (e) { setError(`Publish status is still unknown. ${errorText(e)} Keep this page open and check again.`); }
    finally { inFlight.current = false; setBusy(""); }
  }
  async function publish(retry = false) {
    const candidate = retry ? pending : preview;
    const details = retry ? pendingDetails : previewDetails;
    if (!details || !candidate || candidate.restaurantId !== restaurantId || inFlight.current || (!retry && !menuOnly && !quickDemo) || conflict || storageBlocked) return;
    inFlight.current = true; setBusy("publish"); setError(""); setNotice("");
    let sent = false;
    try {
      const latest = await readCurrent(restaurantId); setCurrent(latest); setMenuRead("ready");
      if (latest && sameMenu(latest, candidate)) { await checkCandidate(candidate, details); return; }
      if ((latest?.version ?? 0) + 1 !== candidate.version || (latest && latest.id !== candidate.id)) {
        if (retry) { setConflict(true); setNotice("The live menu changed while this publication was being checked. Review the draft again before publishing."); }
        else { setPreview(null); setStep(2); setError("The live menu changed since your preview. Check your draft and open a fresh preview before publishing."); }
        return;
      }
      const token = await getStaffAccessToken();
      const currentDetails = (await api.readStallDetails(restaurantId, token)).details;
      if (!currentDetails || JSON.stringify(currentDetails) !== JSON.stringify(details)) { if (retry) setConflict(true); throw new Error("Saved stall details changed. Reload the name and hours and prepare a fresh preview before publishing."); }
      remember(candidate, details); sent = true;
      const result = await api.publishMenu(candidate, token, details.version);
      if (!sameMenu(candidate, result)) throw new ApiError("INVALID_RESPONSE", "The published result does not match this draft.", 200, false);
      finish(result);
    } catch (e) {
      if (sent && (needsReconciliation(e) || e instanceof ApiError && e.code === "STALE_MENU")) {
        setError("We haven’t confirmed whether your menu was published. Checking the live menu now…");
        try { const result = await checkCandidate(candidate, details); if (result !== "published") setError("Publication isn’t confirmed. Keep this page open and use the status check below."); }
        catch { setError("Publication status is unknown. Keep this page open and check again. Your exact menu version has been kept for a safe retry."); }
      } else {
        if (sent && !retry) { setPending(null); try { sessionStorage.removeItem(pendingKey); } catch { /* No live publication was acknowledged. */ } }
        setError(retry ? `We couldn’t retry this publication. Its earlier result still needs checking. ${errorText(e)}` : `Menu not published. ${errorText(e)}`);
      }
    } finally { inFlight.current = false; setBusy(""); }
  }
  function returnAfterConflict() {
    try { sessionStorage.removeItem(pendingKey); } catch { setError("Your browser couldn’t clear the old publish record. Try again before making a new version."); return; }
    setPending(null); setPreview(null); setConflict(false); setMenuOnly(false); setStep(2); setError(""); setNotice("The current live version has been checked. Reconfirm your draft and preview before publishing.");
    setDishes(old => old.map(d => ({ ...d, confirmed: false })));
  }

  return <PageShell restaurantId={restaurantId} active="onboarding">
    <div className={s.onboarding}>
      <header className={s.header}><p className="eyebrow">Your stall, ready to take orders</p><h1 ref={heading} tabIndex={-1}>{published ? "Your menu is live." : ["Let’s get your stall ready.", "Your menu. Just the way you sell it.", "Have a look from your customer’s side."][step - 1]}</h1><p>{published ? "One link for your customers. Every order in one place." : "A little setup now. More time for cooking later."}</p></header>
      <ol className={s.steps} aria-label="Setup progress">{["Stall details", "Review menu", "Preview & publish"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={step >= index + 1 ? s.activeStep : ""}><span>{step > index + 1 ? "✓" : index + 1}</span>{label}</li>)}</ol>
      {error && <div className={`notice ${s.error}`} role="alert" ref={errorNode} tabIndex={-1}><strong>Let’s check that</strong><p>{error}</p>{menuRead === "error" && <button className="btn btn-outline" onClick={refresh} disabled={!!busy}>Check menu connection again</button>}<Link href="/login" className={s.signIn}>Staff sign in</Link></div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {storageBlocked && <p className="notice" role="status">Publishing is paused while the previous browser record needs checking. You can continue editing, but don’t clear that record or start another publication.</p>}
      {busy && <p className={s.busy} role="status" aria-live="polite">{busy === "extract" ? "Reading the names and prices. Hang on to this page…" : busy === "publish" ? "Checking the latest menu and publishing…" : busy === "preview" ? "Checking your review and the latest menu…" : "Checking the live menu…"}</p>}
      {menuRead === "loading" && <p role="status">Checking your current menu…</p>}
      {published ? <section className={`card ${s.success}`}><span className={s.successMark} aria-hidden="true">✓</span><h2>All set. Share your menu.</h2><p><strong>{published.name}</strong> · {published.dishes.length} dishes · version {published.version}</p><p>Menu names, prices, options and the reviewed opening hours are live. Address and contact import remain unavailable.</p><div className={s.actions}><Link href={`/storefront?restaurantId=${restaurantId}`} className="btn btn-primary">Get my menu link & QR →</Link><Link href={`/order/${restaurantId}`} className="btn btn-outline">Open customer menu</Link></div></section> : <fieldset className={s.work} disabled={!!busy || menuRead === "loading"}>
        {step === 1 && <StallDetails onReloadDetails={reloadDetails} name={name} setName={setName} hours={hours} setHours={setHours} sameHours={sameHours} setSameHours={setSameHours} photo={photo} onPhoto={selectPhoto} photoUrl={photoUrl} busy={!!busy} onExtract={extract} onManual={() => { if (mayContinue()) loadDraft(null, "manual"); }} onExample={() => { if (mayContinue()) loadDraft(OCR_DRAFT_FIXTURE, "sample"); }} onExisting={() => { if (current && mayContinue()) loadDraft(null, "current"); }} currentMenu={current?.name ?? ""} existingAvailable={!!current} pageDetails={pageDetails} setPageDetails={setPageDetails} />}
        {step === 2 && <MenuReview quickDemo={quickDemo} dishes={dishes} draft={draft} sources={sources} issues={issues} sample={sample} photoUrl={draft && !sample ? photoUrl : null} onDishChange={changeDish} onConfirmDish={id => confirmDishes([id])} onConfirmAll={() => confirmDishes(dishes.map(d => d.id))} onAddDish={() => { const dish = newDish(); setDishes(old => [...old, dish]); return dish.id; }} onRemoveDish={removeDish} onSourceChange={(id, decision) => { setSources(old => ({ ...old, [id]: decision })); setPreview(null); }} onIssueChange={(id, value) => setIssues(old => ({ ...old, [id]: value }))} onContinue={preparePreview} onBack={() => { setStep(1); setError(""); }} />}
        {step === 3 && preview && <div className={s.stack}>
          <div className={s.previewIntro}><p className="eyebrow">Customer preview</p><h2>This is what they’ll see.</h2><p>Scroll through the menu and tap “Add to order” to try the options. Preview orders won’t go to your kitchen.</p>{sample && <p className="notice">You are previewing the saved, unapproved extraction example.</p>}</div>
          <div className={s.phone}><div className={s.phoneTop} aria-hidden="true"><span>9:41</span><span className={s.island} /><span>● ▰</span></div><div className={s.phoneScreen}><CustomerCart key={JSON.stringify(preview)} restaurantId={restaurantId} previewMenu={preview} previewHours={hoursProblem(hours, sameHours) ? undefined : hoursSummary(hours, sameHours)} /></div><div className={s.phoneBottom} aria-hidden="true" /></div>
          <section className={`card ${s.section}`}><h2>{pending ? "Check your publication" : "Ready to put your menu up?"}</h2><p>Version {preview.version} · reviewed stall details version {previewDetails?.version ?? pendingDetails?.version} · {preview.dishes.filter(d => d.available).length} dishes available to order</p>
            <p className="notice">Publishing saves this menu with the reviewed stall name and opening hours. Address, contact and photo uploads are not saved yet. The demo menu uses its prepared dish photos.</p>
            {!pending ? <>{!quickDemo && <label className={s.check}><input type="checkbox" checked={menuOnly} onChange={e => setMenuOnly(e.target.checked)} />I’ve checked the preview. Publish this menu for the test.</label>}<div className={s.actions}><button className="btn btn-outline" onClick={() => { setStep(2); setPreview(null); }}>← Back to editing</button><button className="btn btn-primary" disabled={(!quickDemo && !menuOnly) || storageBlocked} onClick={() => publish()}>Publish menu →</button></div></> : <><p>Keep this page open until we can confirm what’s live. Retrying uses this same menu and version.</p><div className={s.actions}><button className="btn btn-teal" onClick={reconcile}>Check publication status</button>{conflict ? <button className="btn btn-outline" onClick={returnAfterConflict}>Return to review</button> : <button className="btn btn-outline" disabled={storageBlocked} onClick={() => publish(true)}>Retry this exact publish</button>}</div></>}
          </section>
        </div>}
      </fieldset>}
      {!published && <p className={s.draftNote}>Your draft stays on this page until you publish. Keep it open while reviewing.</p>}
    </div>
  </PageShell>;
}
