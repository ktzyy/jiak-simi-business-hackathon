# Customer demo photograph provenance

`public/demo/menu-photo.jpg` is an unaltered copy of `/private/tmp/jiak-simi-ocr-photos/IMG_4544-upright.jpg`, the previously inspected upright derivative of user-provided `/Users/elsenyong/Downloads/Hawker Photos/IMG_4544.JPG`. The derivative was made only to correct rotation for OCR inspection; this frontend task did not generate, enhance or edit raster pixels. Public copy and existing derivative SHA256 both equal `c3f146830949d0bdcebe50f86411f88da7f744846932d2f642eaa6f91fad2a92`; size 3,566,450 bytes. EXIF-oriented display dimensions are 4032×3024 (4:3).

The fixed demo restaurant's customer page exposes “View menu photo” with the original printed board. Dish cards use CSS background cropping of that same source. `src/components/ordering/demo-photo.ts` contains manually inspected centers for the three current IDs and seven proposed full-menu IDs. Exact restaurant, stable dish ID and unchanged dish name must all match; unrelated uploads/stalls get no inferred image association. Crops are explicitly labelled “From the menu photo”; they are photographs of printed food pictures and can contain print/glare. They do not claim professionally photographed serving portions or an automated photo match.

The menu's reviewed API prices/options remain authoritative: some printed prices are covered or superseded by explicit demo choices. Adding this asset does not publish menu v3 or approve its global modifier rules.

Demo shortcuts link to Telegram, GPT Live and public dummy-stall Cook Mode. Hosted voice requires the supervised laptop relay; Telegram requires the running laptop adapter and accepts private human chats when TELEGRAM_PUBLIC_DEMO=true. These controls do not establish real acoustic acceptance. Kimberley owns forthcoming front-page photo changes; their branch/commit is still pending.

Validation: public/source hashes match; TypeScript and scoped lint passed. The full source was visually inspected before assigning crop centers. Browser crop/layout verification remains part of the integrator's preview check.
