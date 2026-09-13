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
      let stage = "SIGNAL";
      let upstreamStatus: number | null = null;
      let upstreamType = "missing";
      const requestSignalNative = request.signal instanceof AbortSignal;
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timer = setTimeout(abort, 45_000);
      try {
        if (request.signal.aborted) abort();
        else request.signal.addEventListener("abort", abort, { once: true });
        stage = "FETCH";
        response = await fetcher(`${voiceRelayOrigin(process.env.VOICE_BACKEND_URL)}${HANDSFREE_PATH}`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOICE_BACKEND_TOKEN}` },
          body: JSON.stringify(command), redirect: "error", cache: "no-store", signal: controller.signal,
        });
        stage = "CONTENT_TYPE";
        upstreamStatus = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
        const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
        upstreamType = !mime ? "missing" : ["application/json", "text/html", "text/plain", "application/octet-stream"].includes(mime) ? mime : "other";
        if (mime !== "application/json") throw new Error();
        stage = "RESPONSE_BODY";
        if (!response.body) throw new Error();
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break;
            size += part.value.byteLength;
            if (size > HANDSFREE_RESPONSE_LIMIT) { await reader.cancel(); throw new Error(); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        const output = new Uint8Array(size); let offset = 0;
        for (const part of chunks) { output.set(part, offset); offset += part.byteLength; }
        stage = "JSON";
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output));
        stage = "RESPONSE";
        return new Response(new Uint8Array(output), { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      } catch (error) {
        // Fixed stage + allowlisted class only. Never expose message, URL, body,
        // request headers, bearer or stack from a Worker/network exception.
        const name = error instanceof Error && ["TypeError", "AbortError", "TimeoutError", "SyntaxError"].includes(error.name) ? error.name.toUpperCase() : "ERROR";
        console.error("voice_relay_diagnostic", { stage, errorClass: name, upstreamStatus, upstreamType, requestSignalNative });
        throw new HttpError(502, `VOICE_RELAY_${stage}_${name}`, "The voice device could not confirm this step. Check the kitchen queue before retrying an order.");
      } finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); }
    } catch (error) { return errorResponse(error); }
  };
}
