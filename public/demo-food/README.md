# Polished demo food photos

Ten static photos match the ten existing dishes at `DEMO_RESTAURANT_ID`, including the onboarding phone preview. This does not change dish data, API fields, prices, options or the merchant photo-upload workflow.

- Char Siew Rice: existing approved polished photo, reused unchanged (700 × 700).
- Braised Pork Knuckle Rice and Braised Pork Knuckle Noodles.
- Roasted Sausage Rice.
- Chicken Feet Noodle / Hor Fun: photograph shows the fine noodle option.
- Mushroom Chicken Feet.
- Charcoal Char Siew Wanton Noodle.
- Wanton Soup and Dumpling Soup.
- Oyster Sauce Kailan.

The nine new photos were created on 13 September 2026 using built-in image generation. Each used its dish in Kimberley’s original hawker menu photo as the food reference, and the approved Char Siew Rice image as the style reference. They were visually inspected and prepared as 1000 × 1000 JPEGs. Full final prompts and refinement history are in `generation-prompts.json`.

These are polished demo representations, not ingredient-verified photographs of served portions. Details that are ambiguous in the printed menu remain interpretive. A hawker review is needed before using generated details as ingredient or portion evidence.

The UI requires the demo restaurant, stable dish ID and matching normalized name. Elsen’s original menu photo and source-crop mapping remain intact; source crops are the fallback if a polished image cannot load. Unknown dishes and other restaurants retain the existing placeholder. All JPEGs must ship with the frontend; no database or storage-bucket change is required.
