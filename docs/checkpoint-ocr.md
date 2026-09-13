# OCR checkpoint — resumed and verified, 13 September 2026

The current extraction service uses gpt-5.4-mini, exact raw price evidence and deterministic SGD parsing. It leaves slash/range/uncertain prices null and retains add-ons/fees/headings as review evidence. Merchant review is required; no automatic menu publication.

Live service verification completed:
- Soup board: 16 numbered dishes + two visible Rice occurrences; all 18 displayed price occurrences match visual inspection (17 distinct products). Duplicate Rice entries need merchant mapping.
- Tray IMG_4544.JPG: 10 dishes, 10 add-ons, four headings; 22 blockers and four null prices. Remaining omissions/misread names/unsupported associations are documented. Not ready to order from.
- Corrected the model interpreting region as country; now records image position.
- Three paid service calls during resumed verification, all HTTP 200 on first attempt (including region correction verification).

Evidence: `artifacts/ocr-review/service-verification/README.md` and raw JSON files; tracked explanation in `docs/menu-ocr-evaluation.md` and `docs/menu-ocr-photo-provenance.md`. Baseline all-13-photo and earlier evidence evaluations remain preserved separately. Originals unchanged.

Validation: 11 OCR tests, full 35-test suite, TypeScript, lint and webpack production build passed. No photo enhancement, menu publication or order submission performed.
