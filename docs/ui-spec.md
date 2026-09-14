# K1 — Product and UI specification

Status: implementation-ready behavior and design brief; application coding waits for Elsen's starter and frozen shared contract. No sample dish, price or option here is merchant-approved.

## Brand and layout

Use design-tokens.json as the reference. Retain League Spartan, warm cream page, off-white cards, teal headings and coral primary actions. Self-host permitted font files during implementation if available; fall back to system sans without blocking the flow. Card 18px radius; input 10px; CTA 20px; primary button text 20px bold. Modifier chips have dark teal text on light teal when selected plus a check indicator. Error states use explicit text/icon, never colour alone.

Operational text is 16px minimum except 14px supporting labels. Touch targets are at least 44px. Mobile gutters 20px. Use 8/12/16/24px spacing. Customer menu/cart is a single column, max width 480px and centered on larger screens. Merchant review uses one column on phones; at desktop widths (900px+) the photo and draft editor sit side by side. Kitchen uses one column on phones and a responsive card grid on larger screens. No marketing hero, consumer navigation, ratings, decorative food images or custom illustrations.

Create only these shared UI primitives: BrandLockup, PrimaryButton, FormField, StatusMessage, DishRow, ModifierSelector, CartSummary and KitchenTicket. Keep server schemas/client in Elsen's shared module. Use normal page links for navigation; backend supplies session-aware URLs. UI must not establish a new Site or database.

## Surface 1 — Import and review

Opening viewport: text lockup, heading “Turn your menu into an ordering page”, short instruction “Take a clear photo with every dish and price visible”, file/camera input and primary “Read menu” action. Use browser capture as an option while retaining normal upload. Show the selected photo before extraction; enforce the backend's published format/size limits with readable error text.

State sequence: empty → photo selected → extracting → draft review → publishing → published. Allow retry/replacement after failure without erasing an existing editable draft. During extraction show “Reading dishes and prices…” and prevent duplicate submission. Photo preview is temporary; release it on replacement/unmount. Do not save original photo data into localStorage.

Draft review shows the source photo, editable dish names and prices, and modifier groups/options. Support adding/removing a row and explicitly adding options that the merchant confirms. Never default unknown price to zero. Mark unresolved fields with “Check this against your menu.” Provide normal decimal SGD entry, but use the agreed conversion and server validator before publishing. Publishing stays disabled while required values/issues remain unresolved.

Before publish: checkbox “I have checked the dishes, prices and options.” Button “Publish menu”. A confirmed modifier not visible in the photograph is a merchant addition, not an AI extraction claim. Server errors attach to the relevant row where possible and retain the edits. After publication the server menu/version is the source of truth.

## Surface 2 — Published menu and QR

Show “Your menu is ready”, merchant/stall name, QR, visible customer URL and actions “Open customer menu”, “Copy link” and “Open kitchen”. QR encodes only the public customer URL; never admin/session capability tokens. Link copy must have a visible success/error state, with selectable URL as fallback.

A small phone preview uses the same menu data and components as the customer route. No per-merchant theme editor: fixed Jiak Simi brand plus editable stall name. Display photo upload as source/reference only in merchant review, not as invented dish thumbnails. A republish produces the server's next menu version. QR remains pointed at the current public menu if that is the backend contract; otherwise regenerate from the returned URL.

## Surface 3 — Customer menu and cart

Heading is the approved stall name, with modest Jiak Simi for Business attribution. Display dish names and server-sourced SGD prices in readable rows. “Add” opens quantity/modifier selection. Required groups and selection limits are shown beside the group label. No unchecked freeform kitchen notes that evade validation.

Typed input label: “Tell us your order”. Placeholder: “Type a dish and any options from this menu.” Only use the wanton-mee example if supported by the approved menu. Button “Build my cart”. Parsing results replace the proposed cart after review; if the current cart is nonempty, explicitly ask before replacing it. Do not silently merge duplicate lines or drop unresolved requests in the UI.

Clarification state: display the unresolved phrase and only valid choices returned from the approved menu. Preserve the original request. “More vinegar” unsupported by the menu must show a clarification/rejection, not be ignored. Customers can return to tap ordering at any time.

After intent resolution, request a server quote. Show canonical dish/option labels, quantities, line prices and total from the response. Editing any line invalidates the previous quote and disables placement until a new quote succeeds. Display “Unpaid · Pay at stall”. Primary “Place order” is enabled only with a current validated cart and explicit customer action. Model output never triggers placement automatically.

Placement state: disable repeat clicks and show “Sending order…”. After server acknowledgement show order number, complete cart snapshot and “Order received · Pay at stall”. If a known failure occurs before acceptance, show “Not sent” and retain the cart. If acknowledgement is lost, show “Checking whether your order was received…” and reconcile/retry with the same key through the shared client. Do not generate a new key or create a second order on timeout.

Stale menu: show “The menu changed. Review the updated order before placing it.” Reload/requote and require fresh confirmation. Unknown dish/option and conflicting selection errors remain visible beside affected lines. Do not claim a new price is accepted until the customer reviews it.

Optional voice only after the typed flow passes: one push-to-talk control, mic permission state, recording indicator, stop/cancel, editable transcript and existing Build my cart action. Never place from speech. Permission denied/transcription failure returns to the typed field without blocking ordering.

## Surface 4 — Kitchen

Heading “Kitchen orders”, stall name, connection status and last successful refresh. Poll every two seconds using the shared client. Display only server-persisted tickets in stable chronological order; track IDs to avoid duplicates. Show oldest waiting orders first; new tickets remain visible without stealing focus.

Ticket hierarchy: order number and timestamp → large quantity + dish → one explicit line per modifier → total → “Unpaid · Pay at stall”. Do not invent payment controls. No status workflow is required for MVP.

Empty: “No orders yet. New orders will appear here.” Failure: retain already fetched tickets, display “Connection interrupted—orders may be delayed” and retry polling. Show last refreshed time; never imply a stale kitchen list is current. Server-side access controls and workspace isolation are Elsen's responsibility.

## Accessibility and QA acceptance

All inputs have visible labels; inline errors are associated with fields. Loading/quote/order status changes are announced accessibly without reading the whole page on every poll. Keyboard focus stays predictable; dialogs return focus to the invoking control. Colour pairs must pass appropriate contrast checks. Support 200% text zoom and 375px width without horizontal overflow. Display monetary values consistently from server cents; authoritative arithmetic remains server-side.

Accept only after the actual selected photograph can be reviewed/published, an order can be built by both tap and text, unsupported options fail visibly, server quote/ticket agree, and the second device kitchen receives exactly one persisted order.
