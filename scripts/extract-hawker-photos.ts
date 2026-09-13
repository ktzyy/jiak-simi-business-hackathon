import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { extractMenu, MenuExtractionError } from "../src/server/ai/menu-extraction";

/** Run with: node --env-file=.env.local --import tsx scripts/extract-hawker-photos.ts --out /private/tmp/jiak-simi-ocr-results /absolute/menu.jpg */
async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "--out" || !args[1] || args.length < 3) {
    throw new Error("usage");
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("missing_api_key");
  const outputDir = resolve(args[1]);
  await mkdir(outputDir, { recursive: true });
  let accessBlocked = false;
  for (const source of args.slice(2)) {
    if (accessBlocked) break;
    const sourcePath = resolve(source);
    const filename = basename(sourcePath);
    const bytes = await readFile(sourcePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const mimeType = ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" } as Record<string, string>)[extname(filename).toLowerCase()] ?? "unsupported";
    const attempts: { model: string; status: number | null; providerCode?: string }[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      if (accessBlocked) throw new MenuExtractionError("provider_error", "Provider credentials or billing require attention.");
      const request = JSON.parse(String(init?.body)) as { model: string };
      const attempt: (typeof attempts)[number] = { model: request.model, status: null };
      attempts.push(attempt);
      const response = await fetch(url, init);
      attempt.status = response.status;
      if (!response.ok) {
        try {
          const body = await response.clone().json() as { error?: { code?: unknown } };
          const code = body.error?.code;
          // Only known diagnostic codes are retained; no provider messages or headers are logged.
          if (typeof code === "string" && ["insufficient_quota", "invalid_api_key", "model_not_found", "rate_limit_exceeded", "billing_hard_limit_reached"].includes(code)) attempt.providerCode = code;
        } catch { /* Retain HTTP status only when there is no safe diagnostic. */ }
        if ([401, 403].includes(response.status) || ["insufficient_quota", "invalid_api_key", "billing_hard_limit_reached"].includes(attempt.providerCode ?? "")) {
          accessBlocked = true;
          throw new MenuExtractionError("provider_error", "Provider credentials or billing require attention.");
        }
      }
      return response;
    };
    const provenance = { sourceFilename: filename, sourcePath, sourceSha256: sha256, sourceBytes: bytes.byteLength, mimeType, extractedAt: new Date().toISOString(), modelAttempts: attempts };
    const destination = resolve(outputDir, `${filename}.${sha256.slice(0, 12)}.${Date.now()}.json`);
    try {
      const draft = await extractMenu({ image: bytes, mimeType }, { apiKey, fetch: fetcher });
      await writeFile(destination, JSON.stringify({ provenance, draft }, null, 2) + "\n", { flag: "wx" });
      console.log(JSON.stringify({ source: filename, items: draft.items.length, issues: draft.issues.length, output: destination, attempts }));
    } catch (error) {
      const code = error instanceof MenuExtractionError ? error.code : "local_error";
      await writeFile(destination, JSON.stringify({ provenance, failure: { code } }, null, 2) + "\n", { flag: "wx" });
      console.log(JSON.stringify({ source: filename, failure: code, attempts, output: destination }));
      process.exitCode = 1;
    }
  }
}

main().catch((error: unknown) => {
  const allowed = error instanceof Error && ["usage", "missing_api_key"].includes(error.message) ? error.message : "local_error";
  console.error(JSON.stringify({ failure: allowed }));
  process.exitCode = 1;
});
