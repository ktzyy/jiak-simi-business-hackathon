# Kimberley demo sync — 13 September 2026

Site: https://jiak-simi-business-demo.elsenyong.chatgpt.site

The existing Site is public. Kimberley’s latest landing page is restored; See Demo opens the customer menu. Telegram, GPT Live and Cook Mode are linked together. Anonymous edit/publish/completion actions are restricted to restaurant `ba2ad996-da84-4653-89a9-c028d77c050d`. Other stalls retain API authorization. No real payments are processed.

Kim UI commits 2fce99e, 1ec0918 and 11de90572639a2b05524db8cd484899965e35734 are integrated. Her ten polished photos, compact opening-hours editor and layouts are preserved. Original source-photo assets remain available.

## Active backend contracts

Use `src/shared/api-client.ts` and `src/shared/contracts.ts`. `readPublishedStall` returns menu plus its published hours snapshot. `readStallDetails` / `saveStallDetails` use optimistic versioning with seven explicit open/closed days. `publishMenu` requires the reviewed stall-details version. Hours are entered beside the stall name.

Every cart and server quote requires explicit `fulfillmentType` (`dine_in` or `takeaway`), with no default or surcharge. Persisted orders carry it into the kitchen. Submit with the same confirmation key after an uncertain response. `completeKitchenOrder` uses expected status version and an idempotency key; advance only after acknowledgement and refresh counts. Payment remains unpaid.

Menu review now has “Set your extras once”: edit shared names/prices and apply them to every included dish in one action. Required dish choices stay separate. OCR upload, review and publish remain connected to the existing API client and review helpers. Current published demo menu is v3: all ten photographed dishes, eleven photo extras plus Shao Rou, and free chilli preferences. The demo owner explicitly approved global applicability, availability and the required free Noodle/Hor Fun choice. Wanton Soup is S$4; Rice extra is S$0.50. Hosted publication verified 120 dish/add-on prices and selection rules. See FULL-DEMO-MENU-REVIEW.md.

## Evidence and operational limits

The previously deployed recording revision 7220433 passed the hosted S$14 dine-in quote → unpaid submission → same-key replay → one persisted ticket → Done/replay check. Hosted read/quote negative checks cover missing fulfillment, stale menus, invalid modifiers, cross-origin access, invalid staff tokens and cross-stall demo scope. Full OCR and real expired-session hosted browser acceptance remain outstanding. Required-modifier enforcement passed hosted database quotes. No real microphone/speaker acceptance has been claimed.

193 tests have passing coverage across the full run and a loopback-permitted relay rerun; TypeScript passed. Lint has no errors (one ignored verification-script warning). Deployed commit: c8bf859cf88cb419b63624220cc22322e431e132. Landing, See Demo, photo asset and voice page return HTTP 200. The hosted voice API now reaches the authenticated laptop relay and returns the expected VOICE_SESSION_NOT_FOUND for a nonexistent session. The Worker-specific redirect incompatibility is fixed using manual redirects with explicit rejection. Full microphone-to-persisted-ticket acceptance remains outstanding.

Telegram @blackcharsiewbot accepts private human chats in public demo mode, with dummy-stall isolation and shared AI budgets. Its polling process must stay running. GPT Live uses the supervised laptop relay; the laptop, Next server, relay and Quick Tunnel must all remain running. See HANDSFREE-VOICE.md for verbal confirmation and retry behavior.

All three approved database migrations are applied to staging project mikpepfrumtglwweolzq. No new migration is part of this release. Supabase Auth Site URL and callback allow-list include the canonical Site origin and /auth/confirm. Privileged credentials remain server-side.

## Fast demo onboarding

The owner requested skipping unreadable OCR entries and review checkboxes. With NEXT_PUBLIC_DEMO_MODE=true on the fixed dummy stall, names/prices that cannot be read are omitted, shared readable add-ons apply across the menu, per-item/source/issue confirmation gates are hidden, and the preview publishes through one explicit button. Empty menus still require a readable dish; unknown prices never become zero. Required choice rules, seven-day hours, backend scope and publication retry/version checks remain enforced. Normal merchant review outside this demo is unchanged.

## Recording override: three dishes

After the full-menu voice prompt exceeded its limit, the owner explicitly requested three dishes for recording. Published menu v4 contains Char Siew Rice, Braised Pork Knuckle Rice and Braised Pork Knuckle Noodles, preserving all twelve approved extras and chilli preferences. Existing hours are unchanged. The unchanged hands-free prompt is 7,849 characters, within its 24,000-character limit. `scripts/use-three-dish-demo.ts --apply` guarded the exact v3→v4 publication and verified readback; it created no orders. This supersedes the earlier ten-dish live status above; the full menu remains in historical v3.
