import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TicketSchema } from "../../shared/contracts";
import { databaseRpc, type BackendClient } from "../supabase-backend";
import { MessagingReplySchema, MessagingStateSchema, type MessagingStore } from "./core";
const claimSchema = z.strictObject({ status: z.enum(["claimed", "duplicate", "busy"]), conversationId: z.uuid(), leaseId: z.uuid().nullable(), state: MessagingStateSchema.nullable(), sessionTokenHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() });
const okSchema = z.strictObject({ ok: z.literal(true) });
export function createMessagingStore(client: BackendClient): MessagingStore {
  return {
    claim: (binding, incoming) => databaseRpc(client, "messaging_claim_update", { p_provider: binding.provider, p_account_id: binding.accountId, p_restaurant_id: binding.restaurantId, p_recipient_id: incoming.recipientId, p_update_id: incoming.updateId, p_session_token_hash: randomBytes(32).toString("hex") }, claimSchema),
    complete: async (conversationId, leaseId, updateId, state, reply) => { await databaseRpc(client, "messaging_complete_update", { p_conversation_id: conversationId, p_lease_id: leaseId, p_update_id: updateId, p_state: state, p_reply: reply }, okSchema); },
    submit: (conversationId, leaseId, updateId, nonce) => databaseRpc(client, "messaging_submit_order", { p_conversation_id: conversationId, p_lease_id: leaseId, p_update_id: updateId, p_confirmation_nonce: nonce }, TicketSchema),
    claimReply: (conversationId, updateId) => databaseRpc(client, "messaging_claim_reply", { p_conversation_id: conversationId, p_update_id: updateId }, z.strictObject({ status: z.enum(["claimed", "already_attempted"]), reply: MessagingReplySchema.nullable() })),
    finishReply: async (conversationId, updateId, status, providerMessageId) => { await databaseRpc(client, "messaging_finish_reply", { p_conversation_id: conversationId, p_update_id: updateId, p_status: status, p_provider_message_id: providerMessageId }, okSchema); },
  };
}
