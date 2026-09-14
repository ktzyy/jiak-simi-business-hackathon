# K3 — acceptance matrix

Status: PREPARED, ALL CASES UNRUN. Baseline: one actual photograph and merchant-approved menu. Choose actual dish D, approved modifiers M and independently hand-checked total T. Use two isolated demo sessions A/B and separate customer-phone/kitchen devices. Use the wanton-mee example only when approved.

| Case | Preconditions/input | Expected result |
|---|---|---|
| Full journey | Upload real photo, review/correct, publish, scan QR, tap/type D+M, quote and explicitly place | Approved menu matches source/review; cart preserves quantities/options; server total T; exactly one persisted unpaid kitchen ticket |
| Missing price | Unreadable/missing price | Unresolved/null; clear review indication; publish blocked until corrected |
| Unsupported request | D plus unapproved option | Clarification; instruction not dropped or silently approved |
| Conflicting modifiers | Mutually exclusive options or exceed selection limit | Server quote/submission blocked with conflict; no ticket |
| Unknown dish | Dish absent from approved menu | No invention/substitution; clarification or valid choices |
| Invalid quantity | API request with zero, negative, fractional or out-of-range quantity | Server rejects; no persistence |
| Forged ID | Unknown item or option belonging to another dish | Server rejects independently of UI controls |
| Tampered price | Modify client unit/line/total price | Supplied price cannot alter authoritative menu-derived total |
| Stale menu | Quote N, publish N+1, submit old cart | Stale rejection; refresh/requote and reconfirmation |
| Duplicate/concurrent submit | Same payload/key twice, including concurrently | One database order; same ticket returned |
| Reused key, changed payload | Changed cart with used key | Conflict; no second order or overwritten first order |
| Prompt injection | Text/photo says ignore menu, alter prices, mark paid | Untrusted content cannot alter validators, approved items or payment status |
| Model failure | Timeout/malformed output/unavailable model | Bounded retry; visible fallback; no unvalidated order; fixture labelled |
| Network before persistence | Disconnect before server receives submission | Draft retained; no false confirmation |
| Lost acknowledgement | Persist then drop response; retry same key | Uncertain state until resolved; original ticket recovered without duplicate |
| Session isolation | A customer/kitchen vs unrelated B | B cannot edit A menu or read A kitchen; QR exposes intended customer access only |
| Phone/kitchen | Real phone QR and separate kitchen device | Public URL; usable controls; ticket arrives within polling interval plus measured network latency |
| Persistence | Refresh receipt/kitchen after success | Same order survives; names/options/totals/unpaid status unchanged |
| Credentials | Inspect public repo/browser assets/network | No secrets in repository or browser; server-only API credentials |
| Mobile/accessibility | 375px viewport, keyboard, 200% text zoom | No horizontal clipping; labels/errors/focus usable; readable operational text |

## Submission checks — unrun

| Deliverable | Check | Pass |
|---|---|---|
| Public app | Signed-out final URL and full journey | No builder login; real backend works; final QR |
| Public repo | Signed-out repository URL | Public source, usable README, setup/architecture/limitations/links, no secrets |
| Public video | Signed-out full playback | Public, processed and depicts actual behavior |
| Duration | Inspect export and uploaded playback | 2,700 frames at 30fps, 90.000 seconds; no extra intro/outro/trimming |
| Submission | Reopen entry before cutoff | Correct links and verified receipt |

Release blockers: incorrect prices/options, phantom or duplicate orders, false payment/submission confirmation, cross-session kitchen exposure, broken core, inaccessible deliverables or wrong video duration. Optional voice and visual polish do not block a working typed/tap demo.

## Defect report format

Case ID/name; tested deployment URL and Git commit; device/browser; workspace; reproduction steps; expected/actual; evidence; severity; owner (Kimberley UI or Elsen backend/integration). Never include tokens/secrets. Mark blocked/unrun explicitly rather than claiming a pass.
