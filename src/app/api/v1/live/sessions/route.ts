import { voiceHandlers } from "@/server/ai/voice-ordering";

export const runtime = "nodejs";
export const POST = voiceHandlers().create;
