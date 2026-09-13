import { MenuSchema } from "./contracts";

// User-authorized dummy stall based on Kimberley's IMG_4544 mockup.
// Selected visible labels only; not an exhaustive or merchant-approved real menu.
export const DEMO_RESTAURANT_ID = "ba2ad996-da84-4653-89a9-c028d77c050d";
export const DEMO_STAFF_EMAIL = "hawker-demo@jiak-simi.example";
export const DEMO_MENU = MenuSchema.parse({
  id: "0b151d11-36e0-4089-90e0-8265f7b77322",
  restaurantId: DEMO_RESTAURANT_ID,
  version: 1,
  currency: "SGD",
  name: "Roast Meat Demo Menu",
  dishes: [
    { id: "3d080a59-c16a-4b1e-846e-dd7e8307fec0", name: "Char Siew Rice", priceCents: 450, available: true, modifierGroups: [] },
    { id: "9fb8d1d4-552b-42d4-a021-33d2c753bbbc", name: "Braised Pork Knuckle Rice", priceCents: 500, available: true, modifierGroups: [] },
    { id: "19dea502-d55d-4064-bb83-974ef123ec2d", name: "Braised Pork Knuckle Noodles", priceCents: 500, available: true, modifierGroups: [] },
  ],
});
