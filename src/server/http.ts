import "server-only";
import { timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function errorResponse(error: unknown): Response {
  const known = error instanceof HttpError;
  return Response.json({ error: { code: known ? error.code : "SERVICE_ERROR", message: known ? error.message : "The service could not complete this request.", retryable: known && error.status === 429 } }, { status: known ? error.status : 502, headers: { "Cache-Control": "no-store" } });
}

// A single-stall LOCAL integration capability. It is never the public customer token.
// Replace with verified membership + distributed rate limits before public deployment.
const calls = new Map<string, { start: number; count: number }>();
export function authorizeLocalDemo(request: Request, operation: string) {
  if (process.env.NODE_ENV === "production") throw new HttpError(503, "NOT_CONFIGURED", "Public AI access awaits verified membership and distributed rate limits.");
  const expected = process.env.DEMO_STAFF_TOKEN;
  const restaurantId = process.env.DEMO_RESTAURANT_ID;
  if (!expected || expected.length < 32 || !restaurantId) throw new HttpError(503, "NOT_CONFIGURED", "Local demo access has not been configured.");
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b) || request.headers.get("x-restaurant-id") !== restaurantId) throw new HttpError(403, "FORBIDDEN", "This demo capability does not authorize the restaurant.");
  const now = Date.now();
  let entry = calls.get(operation);
  if (!entry || now - entry.start >= 60_000) { entry = { start: now, count: 0 }; calls.set(operation, entry); }
  if (++entry.count > 5) throw new HttpError(429, "RATE_LIMITED", "Please wait before starting another AI request.");
  if (!process.env.OPENAI_API_KEY) throw new HttpError(503, "NOT_CONFIGURED", "OpenAI is not configured.");
  return { restaurantId, apiKey: process.env.OPENAI_API_KEY };
}

export async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) throw new HttpError(400, "INVALID_REQUEST", "A request body is required.");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, "BODY_TOO_LARGE", "Request is too large.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, "BODY_TOO_LARGE", "Request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
