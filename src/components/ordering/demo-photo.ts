import { DEMO_RESTAURANT_ID } from "@/shared/demo-menu";
// Centers manually checked against the upright original, in displayed 4:3 space.
// Stable IDs prevent a newly uploaded/renamed dish acquiring an unrelated photo.
const centers: Record<string, { name: string; x: number; y: number }> = {
  "3d080a59-c16a-4b1e-846e-dd7e8307fec0": { name: "Char Siew Rice", x: .24, y: .39 },
  "9fb8d1d4-552b-42d4-a021-33d2c753bbbc": { name: "Braised Pork Knuckle Rice", x: .21, y: .53 },
  "19dea502-d55d-4064-bb83-974ef123ec2d": { name: "Braised Pork Knuckle Noodles", x: .24, y: .69 },
  "93fef6a9-bdca-448e-8da3-000000000001": { name: "Roasted Sausage Rice", x: .40, y: .32 },
  "93fef6a9-bdca-448e-8da3-000000000002": { name: "Chicken Feet Noodle / Hor Fun", x: .40, y: .51 },
  "93fef6a9-bdca-448e-8da3-000000000003": { name: "Mushroom Chicken Feet", x: .53, y: .41 },
  "93fef6a9-bdca-448e-8da3-000000000004": { name: "Charcoal Char Siew Wanton Noodle", x: .49, y: .70 },
  "93fef6a9-bdca-448e-8da3-000000000005": { name: "Wanton Soup", x: .67, y: .47 },
  "93fef6a9-bdca-448e-8da3-000000000006": { name: "Dumpling Soup", x: .78, y: .41 },
  "93fef6a9-bdca-448e-8da3-000000000007": { name: "Oyster Sauce Kailan", x: .77, y: .53 },
};
export function demoPhotoPosition(restaurantId: string, dish: { id: string; name: string }) {
  const center = centers[dish.id];
  if (restaurantId !== DEMO_RESTAURANT_ID || !center || center.name !== dish.name) return null;
  // The frame and source share 4:3, so a 5× background keeps original proportions.
  return `${((5 * center.x - .5) / 4) * 100}% ${((5 * center.y - .5) / 4) * 100}%`;
}
