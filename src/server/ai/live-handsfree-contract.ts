import { z } from "zod";
import { Id } from "../../shared/contracts";

export const HANDSFREE_PATH = "/api/v1/live/handsfree";
export const HANDSFREE_BODY_LIMIT = 1_400_000;
export const HANDSFREE_RESPONSE_LIMIT = 5_500_000;
export const HandsfreeCommand = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("draft"), voiceSessionId: Id, text: z.string().trim().min(1).max(4000) }),
  z.strictObject({ action: z.literal("start"), restaurantId: Id, sdp: z.string().startsWith("v=0").max(65536) }),
  z.strictObject({ action: z.enum(["status", "close"]), voiceSessionId: Id }),
  z.strictObject({ action: z.enum(["audio", "playback"]), voiceSessionId: Id, readbackId: Id }),
  z.strictObject({ action: z.literal("confirm"), voiceSessionId: Id, readbackId: Id, audio: z.string().min(60).max(1_350_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }),
]);

/** Only the exact operator-configured Quick Tunnel origin, never a client URL. */
export function voiceRelayOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return url.origin;
  } catch { return null; }
}
