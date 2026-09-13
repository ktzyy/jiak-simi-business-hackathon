import "server-only";
import { z } from "zod";
import { decodeTelegramUpdate } from "./telegram";
import { processMessagingUpdate, type MessagingBinding, type MessagingDependencies } from "./core";

const updateSchema = z.object({ update_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).passthrough();
const batchSchema = z.object({ ok: z.literal(true), result: z.array(updateSchema).max(100) });
// A batch advances offset only after durable processing. If an update fails,
// callers retain the old offset and the database deduplicates preceding updates.
export async function processTelegramBatch(input: unknown, binding: MessagingBinding, allowedChatIds: ReadonlySet<string>, deps: MessagingDependencies, offset: number): Promise<number> {
  const batch = batchSchema.parse(input);
  let nextOffset = offset;
  for (const update of batch.result.toSorted((a, b) => a.update_id - b.update_id)) {
    if (update.update_id < offset) continue;
    const incoming = decodeTelegramUpdate(update, allowedChatIds);
    if (incoming) await processMessagingUpdate(binding, incoming, deps);
    nextOffset = Math.max(nextOffset, update.update_id + 1);
  }
  return nextOffset;
}
