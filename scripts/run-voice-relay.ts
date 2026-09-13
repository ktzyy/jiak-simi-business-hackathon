import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PUBLIC_DEMO_BEARER, PUBLIC_DEMO_RESTAURANT_ID } from "../src/shared/public-demo";
import { HANDSFREE_BODY_LIMIT, HANDSFREE_PATH, HANDSFREE_RESPONSE_LIMIT, HandsfreeCommand } from "../src/server/ai/live-handsfree-contract";

const UPSTREAM = `http://localhost:3000${HANDSFREE_PATH}`;
export function createVoiceRelayServer(options: { token: string; demoMode: boolean; fetcher?: typeof fetch }) {
  if (!options.demoMode || !/^[A-Za-z0-9_-]{32,256}$/.test(options.token)) throw new Error("Voice relay requires local DEMO_MODE=true and a configured machine token.");
  const expected = Buffer.from(`Bearer ${options.token}`);
  let active = 0;
  const server = createServer(async (request, response) => {
    const json = (status: number, code: string, message: string) => {
      if (!response.headersSent) response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: { code, message, retryable: false } }));
    };
    if (request.url !== HANDSFREE_PATH) { json(404, "NOT_FOUND", "Unknown route."); return; }
    if (request.method !== "POST") { response.setHeader("Allow", "POST"); json(405, "METHOD_NOT_ALLOWED", "Use POST."); return; }
    const provided = Buffer.from(request.headers.authorization ?? "");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { json(401, "UNAUTHORIZED", "Machine authorization required."); return; }
    if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") { json(415, "INVALID_CONTENT_TYPE", "Send JSON."); return; }
    if (Number(request.headers["content-length"] ?? 0) > HANDSFREE_BODY_LIMIT) { json(413, "BODY_TOO_LARGE", "Voice request is too large."); return; }
    if (active >= 8) { json(429, "RELAY_BUSY", "Voice relay is busy."); return; }
    active++;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 45_000);
    request.setTimeout(10_000, () => { abort.abort(); request.destroy(); });
    response.once("close", () => { if (!response.writableFinished) abort.abort(); });
    try {
      let length = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        length += chunk.length;
        if (length > HANDSFREE_BODY_LIMIT) { json(413, "BODY_TOO_LARGE", "Voice request is too large."); return; }
        chunks.push(Buffer.from(chunk));
      }
      request.setTimeout(0); // The bounded upstream operation has its own 45s deadline.
      let command;
      try { command = HandsfreeCommand.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { json(400, "INVALID_REQUEST", "Invalid voice command."); return; }
      if (command.action === "start" && command.restaurantId !== PUBLIC_DEMO_RESTAURANT_ID) { json(403, "FORBIDDEN", "Voice is restricted to the dummy stall."); return; }
      const upstream = await (options.fetcher ?? fetch)(UPSTREAM, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${PUBLIC_DEMO_BEARER}`, Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin" },
        body: JSON.stringify(command), redirect: "error", cache: "no-store", signal: abort.signal,
      });
      if (upstream.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || !upstream.body) throw new Error();
      const reader = upstream.body.getReader(), output: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > HANDSFREE_RESPONSE_LIMIT) { await reader.cancel(); throw new Error(); } output.push(part.value); }
      } finally { reader.releaseLock(); }
      const payload = Buffer.concat(output); JSON.parse(payload.toString("utf8"));
      response.writeHead(upstream.status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(payload);
    } catch { if (!response.destroyed) json(502, "VOICE_RELAY_UNAVAILABLE", "Voice device unavailable. Check the kitchen queue before retrying an order."); }
    finally { clearTimeout(timer); active--; }
  });
  server.headersTimeout = 5000; server.requestTimeout = 45000; server.keepAliveTimeout = 1000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const server = createVoiceRelayServer({ token: process.env.VOICE_BACKEND_TOKEN ?? "", demoMode: process.env.DEMO_MODE === "true" });
    server.on("error", () => { process.stderr.write("Voice relay could not listen.\n"); process.exitCode = 1; });
    server.listen(3002, "127.0.0.1", () => process.stdout.write("Voice relay listening on 127.0.0.1:3002; only the handsfree API is exposed.\n"));
  } catch { process.stderr.write("Voice relay configuration is incomplete.\n"); process.exitCode = 1; }
}
