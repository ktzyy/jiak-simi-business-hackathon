import { telegramWebhook } from "@/server/messaging/handler";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) { return telegramWebhook(request); }
