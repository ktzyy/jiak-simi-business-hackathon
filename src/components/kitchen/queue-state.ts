import { z } from "zod";
import { CompleteKitchenOrderSchema, type Ticket } from "@/shared/contracts";

export const completionRecordSchema = z.strictObject({ input: CompleteKitchenOrderSchema, key: z.uuid(), uncertain: z.boolean() });
export type CompletionRecord = z.infer<typeof completionRecordSchema>;
export function completedRecordMatches(record: CompletionRecord, ticket: Ticket): boolean {
  return ticket.id === record.input.orderId && ticket.cart.restaurantId === record.input.restaurantId && ticket.status === "done" && ticket.statusVersion > record.input.expectedStatusVersion && ticket.completedAt !== null && ticket.paymentStatus === "unpaid";
}
export function activeQueue(orders: Ticket[]): Ticket[] {
  return orders.filter(ticket => ticket.status === "received").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
}
export function selectQueueOrder(orders: Ticket[], selectedId: string | null): string | null {
  const queue = activeQueue(orders);
  return queue.some(ticket => ticket.id === selectedId) ? selectedId : queue[0]?.id ?? null;
}
