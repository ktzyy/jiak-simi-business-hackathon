import "server-only";
import WebSocket from "ws";
import { LiveSessionError } from "./live-session";

// A bounded, awaited control connection; never a background worker in a route.
// The caller must resolve this opaque provider ID from a server-owned session.
export async function closeLiveSession(sessionId: string, apiKey: string, socketFactory: (url: string, options: WebSocket.ClientOptions) => WebSocket = (url, options) => new WebSocket(url, options)): Promise<void> {
  if (!sessionId || sessionId.length > 512 || !apiKey) throw new LiveSessionError("Voice termination is not configured.");
  await new Promise<void>((resolve, reject) => {
    const socket = socketFactory(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/attach`, { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 8000, maxPayload: 64_000 });
    let done = false;
    const finish = (confirmed: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      socket.terminate();
      if (confirmed) resolve(); else reject(new LiveSessionError("Voice termination could not be confirmed. Retry End."));
    };
    const timeout = setTimeout(() => finish(false), 10_000);
    socket.on("open", () => {
      try { socket.send(JSON.stringify({ type: "session.close" }), error => { if (error) finish(false); }); }
      catch { finish(false); }
    });
    socket.on("message", data => {
      try {
        const event: unknown = JSON.parse(data.toString());
        if (event && typeof event === "object" && "type" in event) {
          if (event.type === "session.closed") finish(true);
          else if (event.type === "error") finish(false);
        }
      } catch { finish(false); }
    });
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
  });
}
