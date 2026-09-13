import { z } from "zod";

export const Id = z.uuid();
export const FulfillmentTypeSchema = z.enum(["dine_in", "takeaway"]);
const cents = z.number().int().min(0).max(1_000_000);
export const OptionSchema = z.strictObject({ id: Id, name: z.string().min(1).max(120), priceDeltaCents: z.number().int().min(-1_000_000).max(1_000_000) });
export const GroupSchema = z.strictObject({ id: Id, name: z.string().min(1).max(120), minSelections: z.number().int().min(0).max(20), maxSelections: z.number().int().min(0).max(20), options: z.array(OptionSchema).max(20) });
export const DishSchema = z.strictObject({ id: Id, name: z.string().min(1).max(120), priceCents: cents, available: z.boolean(), modifierGroups: z.array(GroupSchema).max(20) });
export const MenuSchema = z.strictObject({ id: Id, restaurantId: Id, version: z.number().int().positive(), currency: z.literal("SGD"), name: z.string().min(1).max(120), dishes: z.array(DishSchema).min(1).max(100) }).superRefine((menu, ctx) => {
  const dishes = new Set<string>();
  for (const dish of menu.dishes) {
    if (dishes.has(dish.id)) ctx.addIssue({ code: "custom", message: "Dish IDs must be unique." });
    dishes.add(dish.id);
    const groups = new Set<string>(), options = new Set<string>();
    for (const group of dish.modifierGroups) {
      if (groups.has(group.id) || group.minSelections > group.maxSelections || group.maxSelections > group.options.length) ctx.addIssue({ code: "custom", message: "Modifier group identity or limits are invalid." });
      groups.add(group.id);
      for (const option of group.options) {
        if (options.has(option.id)) ctx.addIssue({ code: "custom", message: "Option IDs must be unique within a dish." });
        options.add(option.id);
      }
    }
  }
});
export const CartLineSchema = z.strictObject({ dishId: Id, quantity: z.number().int().min(1).max(20), optionIds: z.array(Id).max(100) });
export const CartRequestSchema = z.strictObject({ restaurantId: Id, menuId: Id, menuVersion: z.number().int().positive(), fulfillmentType: FulfillmentTypeSchema, lines: z.array(CartLineSchema).min(1).max(50) });
export const IssueSchema = z.strictObject({ code: z.string(), message: z.string(), lineIndex: z.number().int().nonnegative().nullable() });
export const IntentSchema = z.strictObject({ restaurantId: Id, menuId: Id, menuVersion: z.number().int().positive(), fulfillmentType: FulfillmentTypeSchema.nullable(), lines: z.array(CartLineSchema).max(50), issues: z.array(IssueSchema).max(50) });
export const QuoteLineSchema = z.strictObject({ dishId: Id, name: z.string(), quantity: z.number().int().positive(), options: z.array(OptionSchema), unitPriceCents: cents, lineTotalCents: z.number().int().nonnegative() });
export const QuoteSchema = z.strictObject({ restaurantId: Id, menuId: Id, menuVersion: z.number().int().positive(), fulfillmentType: FulfillmentTypeSchema, currency: z.literal("SGD"), lines: z.array(QuoteLineSchema), totalCents: z.number().int().nonnegative() });
// Only historical ticket responses may have an explicitly unknown fulfillment mode.
export const TicketCartSchema = QuoteSchema.extend({ fulfillmentType: FulfillmentTypeSchema.nullable() });
export const TicketSchema = z.strictObject({ id: Id, createdAt: z.iso.datetime({ offset: true }), source: z.enum(["web", "whatsapp", "telegram", "voice"]), status: z.enum(["received", "done"]), statusVersion: z.number().int().positive(), completedAt: z.iso.datetime({ offset: true }).nullable(), paymentStatus: z.literal("unpaid"), cart: TicketCartSchema });
export const CompleteKitchenOrderSchema = z.strictObject({ restaurantId: Id, orderId: Id, expectedStatusVersion: z.number().int().positive() });
export const KitchenResponseSchema = z.strictObject({ orders: z.array(TicketSchema), counts: z.strictObject({ received: z.number().int().nonnegative(), done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }) });
export const SubmitSchema = z.strictObject({ cart: CartRequestSchema, reviewedTotalCents: z.number().int().nonnegative(), confirmed: z.literal(true) });
export const ErrorSchema = z.strictObject({ error: z.strictObject({ code: z.string(), message: z.string(), retryable: z.boolean() }) });
export type Menu = z.infer<typeof MenuSchema>;
export type CartRequest = z.infer<typeof CartRequestSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type Ticket = z.infer<typeof TicketSchema>;
export type Intent = z.infer<typeof IntentSchema>;
