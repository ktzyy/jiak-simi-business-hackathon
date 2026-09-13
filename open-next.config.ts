import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Supabase owns persistence. No Worker-side ISR cache or database binding.
const config = { ...defineCloudflareConfig(), buildCommand: "npm run build -- --webpack" };
export default config;
