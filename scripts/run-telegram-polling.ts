import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { createTelegramDependencies, telegramSettings } from "../src/server/messaging/handler";
import { processTelegramBatch } from "../src/server/messaging/polling";

// This runner replies to allowlisted customers, or private chats in explicitly enabled public dummy mode.
// Start only after the user authorizes live demo operation. Never log token URLs.
async function main() {
  const settings = telegramSettings();
  const dependencies = createTelegramDependencies(settings);
  const lockPath = join(tmpdir(), `jiak-telegram-${settings.accountId}.lock`);
  try { await mkdir(lockPath); }
  catch { throw new Error("A Telegram polling lock exists or cannot be created. Stop the other runner; inspect any stale lock before removing it."); }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const api = async (method: string, body: Record<string, unknown>, timeoutMs: number) => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${settings.token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]) });
      if (!response.ok) throw new Error("provider response failed");
      return await response.json() as unknown;
    } catch { throw new Error("Telegram request did not complete; no update offset was advanced."); }
  };
  try {
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
    const webhook = z.object({ ok: z.literal(true), result: z.object({ url: z.string() }) }).parse(await api("getWebhookInfo", {}, 15_000));
    if (webhook.result.url) throw new Error("A Telegram webhook is active. Disable it intentionally before using polling; this runner will not delete it.");
    let offset = 0;
    console.log(`Telegram polling started for the ${settings.publicDemo ? "public private-chat dummy stall" : "allowlisted demo"}. Press Ctrl+C to stop.`);
    while (!controller.signal.aborted) {
      try {
        const batch = await api("getUpdates", { offset, timeout: 25, limit: 20, allowed_updates: ["message", "callback_query"] }, 35_000);
        offset = await processTelegramBatch(batch, { provider: "telegram", accountId: settings.accountId, restaurantId: settings.restaurantId }, new Set(settings.allowedChatIds), dependencies, offset, settings.publicDemo === true);
      } catch {
        if (controller.signal.aborted) break;
        console.error("An update is pending recovery. Retaining its offset and retrying shortly.");
        await delay(5000, undefined, { signal: controller.signal }).catch(() => {});
      }
    }
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    await rm(lockPath, { recursive: true, force: true });
  }
}
main().catch(() => { console.error("Telegram polling could not start or finish. Check configuration, database readiness, webhook status and the local runner lock; no credentials were logged."); process.exitCode = 1; });
