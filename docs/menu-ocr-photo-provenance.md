# OCR source evidence and optional food photos

This is the OCR lane's handoff for the 13 September photo proposal. It describes the available evidence and remaining work; it does not freeze a new API or implement photo enhancement/storage.

Current extraction returns `draft.id`, a server-generated `item.id`, and `item.sourceEntryId` pointing to a server-generated `sourceEntries[].id`. A source entry preserves its exact observed name/price, printed item number when present, and a textual location within the image. The batch artifacts additionally record the input filename, byte count, MIME type and SHA256. The same draft retains those relationships, but a fresh extraction generates new IDs. Persist the draft and its original source identity before relying on those links across sessions.

`region` is a model-proposed location in the image, not a country and not a validated crop rectangle. It cannot alone support automated cropping or a confirmed dish/photo match. Multiple occurrences such as the Rice panels on both edges of the orange board remain separate evidence; an operator resolves whether they describe the same product. A crop of a menu photograph is also a photograph of printed food, with possible glare and limited detail.

For a future frozen photo contract, preserve these distinct records:

- Immutable source asset identity and hash, original dimensions/orientation, normalized derivative identity/hash, and the exact orientation/resize transform. Keep originals unchanged; normalize MPO/HEIC to conventional supported image bytes before provider dispatch.
- Crop proposal tied to that normalized asset and `sourceEntryId`, with explicit pixel coordinate space, bounding rectangle, and proposer. Text evidence and food-photo regions may differ. Validate bounds server-side and show the crop for merchant review.
- Merchant-confirmed item/photo match tied to the item, source asset and crop revision. A guessed rectangle or model similarity is not confirmation. Replacement of any source/crop invalidates its match and subsequent enhancement approval.
- Separate enhancement job/candidate identities and merchant selection; publish only an explicitly selected asset pinned into the immutable menu version. An extraction result cannot set approval. A failed/absent photo remains compatible with a text-only item.

The new photo proposal still needs restaurant-scoped private source storage, explicit retention/deletion, image decoding/dimension limits, quota controls, job reconciliation and asset approval validation in its own implementation. None is supplied by the current OCR draft. Source selection must minimize unrelated personal/contact details; never publish the whole menu-board upload as a dish image. Do not infer ingredients, portion size, allergens or availability from a food photo.
