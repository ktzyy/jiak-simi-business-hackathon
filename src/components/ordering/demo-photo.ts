import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";

// Prepared photos from the roast-meat demo's original menu, not crops from a
// newly uploaded image. Exact aliases let OCR's fresh UUIDs use this same set.
const photos = [
  { id: "3d080a59-c16a-4b1e-846e-dd7e8307fec0", names: ["Char Siew Rice"], file: "char-siew-rice", x: .24, y: .39 },
  { id: "9fb8d1d4-552b-42d4-a021-33d2c753bbbc", names: ["Braised Pork Knuckle Rice"], file: "braised-pork-knuckle-rice", x: .21, y: .53 },
  { id: "19dea502-d55d-4064-bb83-974ef123ec2d", names: ["Braised Pork Knuckle Noodles", "Braised Pork Knuckle Noodle"], file: "braised-pork-knuckle-noodles", x: .24, y: .69 },
  { id: "93fef6a9-bdca-448e-8da3-000000000001", names: ["Roasted Sausage Rice"], file: "roasted-sausage-rice", x: .40, y: .32 },
  { id: "93fef6a9-bdca-448e-8da3-000000000002", names: ["Chicken Feet Noodle / Hor Fun", "Chicken Feet Noodles / Hor Fun"], file: "chicken-feet-noodles", x: .40, y: .51 },
  { id: "93fef6a9-bdca-448e-8da3-000000000003", names: ["Mushroom Chicken Feet"], file: "mushroom-chicken-feet", x: .53, y: .41 },
  { id: "93fef6a9-bdca-448e-8da3-000000000004", names: ["Charcoal Char Siew Wanton Noodle", "Charcoal Char Siew Wanton Noodles"], file: "charcoal-char-siew-wanton-noodles", x: .49, y: .70 },
  { id: "93fef6a9-bdca-448e-8da3-000000000005", names: ["Wanton Soup"], file: "wanton-soup", x: .67, y: .47 },
  { id: "93fef6a9-bdca-448e-8da3-000000000006", names: ["Dumpling Soup"], file: "dumpling-soup", x: .78, y: .41 },
  { id: "93fef6a9-bdca-448e-8da3-000000000007", names: ["Oyster Sauce Kailan"], file: "oyster-sauce-kailan", x: .77, y: .53 },
];

function normalize(name: string) {
  return name.normalize("NFKC").trim().toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
}

export function demoPhotoForDish(restaurantId: string, dish: { id: string; name: string }) {
  if (restaurantId !== DEMO_RESTAURANT_ID) return null;
  const nameMatches = (photo: typeof photos[number]) => photo.names.some(name => normalize(name) === normalize(dish.name));
  const seeded = photos.find(photo => photo.id === dish.id);
  const photo = seeded ? (nameMatches(seeded) ? seeded : undefined) : photos.find(nameMatches);
  if (!photo) return null;
  return {
    source: `/demo-food/${photo.file}.jpg`,
    // Centers manually checked against the upright original, in 4:3 space.
    position: `${((5 * photo.x - .5) / 4) * 100}% ${((5 * photo.y - .5) / 4) * 100}%`,
  };
}

export function demoPhotoPosition(restaurantId: string, dish: { id: string; name: string }) {
  return demoPhotoForDish(restaurantId, dish)?.position ?? null;
}
