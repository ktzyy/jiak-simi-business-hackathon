import "server-only";
import { PUBLIC_DEMO_BEARER, PUBLIC_DEMO_RESTAURANT_ID } from "../../shared/public-demo";
import { errorResponse, HttpError, readBoundedBody } from "../http";
import { requireSameOrigin } from "../supabase-backend";
import { HANDSFREE_BODY_LIMIT, HANDSFREE_PATH, HANDSFREE_RESPONSE_LIMIT, HandsfreeCommand, voiceRelayOrigin } from "./live-handsfree-contract";

export function voiceRelayConfigured(): boolean {
  return process.env.DEMO_MODE === "true" && !!voiceRelayOrigin(process.env.VOICE_BACKEND_URL) && /^[A-Za-z0-9_-]{32,256}$/.test(process.env.VOICE_BACKEND_TOKEN ?? "");
}

export function hostedHandsfreeProxy(fetcher = fetch) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST.");
      if (!voiceRelayConfigured()) throw new HttpError(503, "VOICE_RELAY_UNAVAILABLE", "The supervised voice device is offline.");
      requireSameOrigin(request);
      if (request.headers.get("authorization") !== `Bearer ${PUBLIC_DEMO_BEARER}`) throw new HttpError(401, "UNAUTHORIZED", "Use the public demo voice page.");
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new HttpError(415, "INVALID_CONTENT_TYPE", "Send JSON.");
      const bytes = await readBoundedBody(request, HANDSFREE_BODY_LIMIT);
      let command;
      try { command = HandsfreeCommand.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
      catch { throw new HttpError(400, "INVALID_REQUEST", "Invalid voice command."); }
      if (command.action === "start" && command.restaurantId !== PUBLIC_DEMO_RESTAURANT_ID) throw new HttpError(403, "FORBIDDEN", "Voice is restricted to the dummy stall.");
      let response: Response;
      try {
        response = await fetcher(`${voiceRelayOrigin(process.env.VOICE_BACKEND_URL)}${HANDSFREE_PATH}`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOICE_BACKEND_TOKEN}` },
          body: JSON.stringify(command), redirect: "error", cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
        });
        if (response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new Error();
        const output = await readBoundedBody(new Request("https://relay-response.invalid", { method: "POST", body: response.body, duplex: "half" } as RequestInit), HANDSFREE_RESPONSE_LIMIT);
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output));
        return new Response(new Uint8Array(output), { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      } catch { throw new HttpError(502, "VOICE_RELAY_UNAVAILABLE", "The voice device could not confirm this step. Check the kitchen queue before retrying an order."); }
    } catch (error) { return errorResponse(error); }
  };
}
