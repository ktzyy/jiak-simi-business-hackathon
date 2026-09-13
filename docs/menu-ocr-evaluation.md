# Real-photo evidence evaluation, 13 September 2026

This separately labelled evaluation uses `gpt-5.4-mini` once per photograph with a transcription/evidence schema. The evaluation initially preserved production routing. Its observed improvement subsequently informed a service change to `gpt-5.4-mini` by default with one same-model technical retry. Baseline outputs were preserved. Prompts did not contain expected dishes, counts, or prices. Source SHA256 and instruction SHA256 are recorded with each evidence-evaluation result. The subsequent live service verification is recorded separately below.

```sh
node --env-file=.env.local --import tsx scripts/evaluate-menu-evidence.ts --out /private/tmp/jiak-simi-ocr-evidence /absolute/path/menu.jpg
```

The script preserves exact raw price text and derives a single price only from a lone `$number` or `S$number` token. Slash prices, ranges, quantities, and illegible prices stay unresolved. Evidence is explicitly unreviewed and independent of the approved menu API contract.

| Photo | Baseline result | Stronger evidence result | Visual review |
| --- | --- | --- | --- |
| `IMG_8509-decoded.jpg`, orange numbered soup/dish board | 1 item, incomplete name | 16 numbered dishes + Rice | All 17 displayed prices match visual inspection; no observed price errors. Names align with visible English labels. |
| `IMG_4544.JPG`, rotated tray menu | 1 item | 8 dishes, 10 add-ons, 3 headings | Substantial improvement but incomplete and contains errors. Not ready for automatic publication. |

The tray result omits the Mushroom Chicken Feet dish, Oyster Sauce Kailan, and Peanut add-on. It misreads “Add Roasted Sausage” as “Add Braised Sausage” and includes an unsupported “BRAISED” heading. The reported Wanton Soup price may incorrectly attach the handwritten Oyster Sauce Kailan sticker. The Rice price is not clearly supported in the glare. Those prices require operator verification; no exact total price-error count is claimed for that image.

A visually supported ordering example from the orange board is item 8, Cordyceps Flower Chicken Soup, `$6.00`, plus Rice, `$0.50`, totaling `$6.50`. This is a pricing illustration, not a submitted or published order. The board must still be reviewed and explicitly approved by its operator before use in live ordering.

These are two-photo observations, not a general OCR accuracy benchmark. Clear, upright, sufficiently close images materially outperform the rotated reflective tray photo. The evidence schema makes omissions and questionable price associations easier to review than a generated order-ready menu.

## Live service verification after resume

The actual `extractMenu` service was called on both photos with the final schema and prompt. All three requests returned HTTP 200 on their first attempt: orange board once before and once after the source-region clarification, then the original rotated tray. No expected dish counts, prices, names or manual corrections were supplied to those requests. Raw results are preserved under `artifacts/ocr-review/service-verification/`.

The first orange-board service result transcribed all prices correctly but interpreted `region` as the country (`Singapore`). The schema description and input instruction now explicitly define an image location. The second result has useful row/column locations. Those descriptions remain unverified proposals, not crop coordinates.

| Current service input | Output | Visual assessment |
| --- | --- | --- |
| Orange board, `IMG_8509-decoded.jpg` | 16 numbered dish items, 2 Rice add-on occurrences, 3 blocking review/mapping issues | All 16 numbered dishes recovered. All 18 price occurrences match their visible labels: 16 dish prices and two $0.50 Rice labels. That is 17 distinct named products; repeated Rice panels are deliberately not merged or assigned automatically. |
| Original `IMG_4544.JPG` | 10 dish items, 10 add-ons, 4 heading/banner entries, 22 blocking issues | Recovers Mushroom Chicken Feet and Oyster Sauce Kailan missed by the earlier evidence run. Still omits Peanut and misreads Add Roasted Sausage as Add Braised Sausage. The Wanton Soup $4.50 association remains unsupported by the obscured label. Rice remains hard to verify. Four price values are null because the model marked uncertainty. No aggregate accuracy score is claimed. |

The tray also proposes generic `menuLabel` values such as “main board”/“addon panel” and reads a banner poorly. This creates a conservative multiple-menu review blocker; it is not evidence of multiple restaurants. An operator must correct these labels and all uncertain/misread evidence before approval. Regions may describe the model's mentally rotated view; never use them as crop coordinates.

The original tray bytes were accepted by the Responses image-input path in this run. This does not establish compatibility with the separate image editing service, which reportedly rejected the same JPG as MPO; conventional-format normalization is still a requirement for that future path.

Scoped OCR unit tests passed 11/11 and ESLint passed for the service, schema, tests and runner. These results verify extraction and draft validation only: no menu was published, no photo was enhanced, and no real order or database write was made by these runs.
