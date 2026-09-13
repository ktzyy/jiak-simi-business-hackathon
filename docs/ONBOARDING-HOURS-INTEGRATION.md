# Onboarding hours integration

Kimberley's existing stall-name layout now loads authenticated saved name/hours and preserves the current details version. New setup starts with seven unresolved days and no selected opening time. Same-hours is an explicit choice; closed days and one to four opening periods use the shared Singapore-time validation, including overnight and Sunday/Monday overlap checks. Existing split schedules and minute precision are preserved when loaded.

Preparing the menu preview validates all OCR review decisions, converts the hours to seven canonical weekday records and saves changed name/hours using the displayed saved `expectedVersion`. Unchanged details do not create another version. Saves do not publish. A stale/uncertain save preserves edits and requires reading/reviewing saved details; “Reload saved name and hours” is an explicit replacement of the local inputs.

The preview pins the returned details snapshot. Publication checks that it still matches the current saved details and calls `publishMenu(menu, staffAccessToken, details.version)`. The browser's pending record stores both exact Menu and reviewed details. Unknown outcomes reconcile both against `readPublishedStall`; a matching menu paired with different/absent hours is not treated as success. Retries retain the original menu version and reviewed details. Old menu-only pending records fail closed instead of acquiring unreviewed current hours.

Address/contact/link import remains explicitly unavailable. Onboarding only edits its own components; the customer screen's published-hours display is owned by the ordering integration lane.

Validation: 20 onboarding state tests pass, including saved four-period roundtrip, no defaults, split breaks, wraparound overlap and exact publication-envelope recovery; TypeScript and scoped lint pass. No live menu was published by these UI checks and no database migration was added. Browser interaction acceptance remains part of the integrator's UI verification.
