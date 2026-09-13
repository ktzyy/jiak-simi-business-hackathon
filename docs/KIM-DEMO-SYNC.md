# Kimberley demo sync — 13 September 2026

Site: https://jiak-simi-business-demo.elsenyong.chatgpt.site

The existing Site is public. In demo mode the root opens the customer menu; Telegram, GPT Live and Cook Mode are linked together. Anonymous edit/publish/completion actions are restricted to restaurant `ba2ad996-da84-4653-89a9-c028d77c050d`. Other stalls retain API authorization. No real payments are processed.

Kim UI commits 2fce99e and 1ec0918 are integrated. Please send the forthcoming photo branch and commit; preserve your approved layouts when integrating those assets. The customer page currently exposes the photographed source menu and labelled source crops.

## Active backend contracts

Use `src/shared/api-client.ts` and `src/shared/contracts.ts`. `readPublishedStall` returns menu plus its published hours snapshot. `readStallDetails` / `saveStallDetails` use optimistic versioning with seven explicit open/closed days. `publishMenu` requires the reviewed stall-details version. Hours are entered beside the stall name.

Every cart and server quote requires explicit `fulfillmentType` (`dine_in` or `takeaway`), with no default or surcharge. Persisted orders carry it into the kitchen. Submit with the same confirmation key after an uncertain response. `completeKitchenOrder` uses expected status version and an idempotency key; advance only after acknowledgement and refresh counts. Payment remains unpaid.

Menu review now has “Set your extras once”: edit shared names/prices and apply them to every included dish in one action. Required dish choices stay separate. OCR upload, review and publish remain connected to the existing API client and review helpers. Current published demo menu is v3: all ten photographed dishes, eleven photo extras plus Shao Rou, and free chilli preferences. The demo owner explicitly approved global applicability, availability and the required free Noodle/Hor Fun choice. Wanton Soup is S$4; Rice extra is S$0.50. Hosted publication verified 120 dish/add-on prices and selection rules. See FULL-DEMO-MENU-REVIEW.md.

## Evidence and operational limits

The previously deployed recording revision 7220433 passed the hosted S$14 dine-in quote → unpaid submission → same-key replay → one persisted ticket → Done/replay check. Hosted read/quote negative checks cover missing fulfillment, stale menus, invalid modifiers, cross-origin access, invalid staff tokens and cross-stall demo scope. Full OCR, required-modifier and real expired-session hosted acceptance remain outstanding. No real microphone/speaker acceptance has been claimed.

193 tests have passing coverage across the full run and a loopback-permitted relay rerun; TypeScript passed. Lint has no errors (one ignored verification-script warning). Customer-first release f3489349d3fbb865f4adfc477005a5a6043ffa28 is deployed. Root redirect, channel buttons, source photo and voice page passed hosted HTTP checks. The hosted voice proxy currently returns 502 for a valid status request; investigation is in progress. Direct authenticated relay checks pass.

Telegram @blackcharsiewbot accepts private human chats in public demo mode, with dummy-stall isolation and shared AI budgets. Its polling process must stay running. GPT Live uses the supervised laptop relay; the laptop, Next server, relay and Quick Tunnel must all remain running. See HANDSFREE-VOICE.md for verbal confirmation and retry behavior.

All three approved database migrations are applied to staging project mikpepfrumtglwweolzq. No new migration is part of this release. Supabase Auth Site URL and callback allow-list include the canonical Site origin and /auth/confirm. Privileged credentials remain server-side.
