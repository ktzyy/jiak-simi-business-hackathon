import { hostedHandsfreeProxy } from "@/server/ai/live-relay-proxy";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return hostedHandsfreeProxy()(request);
  const { handsfreeHandler } = await import("@/server/ai/live-handsfree");
  return handsfreeHandler()(request);
}
