# Sites staging registration and runtime checks

The demo is registered as `appgprj_6aa6330ed72c819186a4fff3288b4caf`. Reuse the project ID in `.openai/hosting.json`; never create a replacement Site. The owner requested **private and unpublished** registration. No Site version has been saved or deployed, and no runtime secrets have been uploaded.

Assigned `expected_url`: https://jiak-simi-business-demo.zesty-crown-3337.chatgpt.site

For staging Auth configuration, use that origin as the Site URL and the exact redirect https://jiak-simi-business-demo.zesty-crown-3337.chatgpt.site/auth/confirm. Retain the local callback http://localhost:3000/auth/confirm for laptop testing. These addresses are configuration targets; the reserved Site is not live. This task has not changed the remote Auth URL settings or email template.

## Runtime evidence and remaining deployment checks

- Next.js 16.3.4 builds through pinned OpenNext Cloudflare 1.20.6 and Wrangler 4.131.1 with `nodejs_compat`. The local Worker serves the menu API (200) and login (200), redirects anonymous merchant access to login (307), and allows the narrow public customer path past Auth (404 until Kimberley's page exists).
- OpenNext labels Node.js middleware support experimental. The local checks establish the adapter can execute the current proxy; staging Auth refresh/callback and a complete signed-out ordering flow still require testing after an authorized deployment.
- APIs use the same origin. Guest cookies are restaurant-scoped, HttpOnly, SameSite=Strict, and production cookies use the `__Host-` prefix, Path=/ and Secure without a Domain attribute. HTTPS browser behavior must be checked on the actual Site.
- OCR uses a synchronous server deadline of 150 seconds, with no automatic paid retry. Cloudflare documents HTTP wall time separately from CPU limits; that does not establish the Sites dispatcher's request limit. A real staging OCR request must complete within its effective deadline before calling hosted OCR verified.
- `/voice-test` and GPT-Live session creation remain development-only. Telegram audio uses the laptop's macOS decoder and is disabled in production. Telegram text and web orders use Supabase HTTP APIs; no local disk database is needed.

## Secure build and eventual deployment

Use `npm run build:sites` to prepare Worker output and assets. OpenNext copies local environment values into a generated module by default; the build script strips that module before packaging and checks output for known local credentials. Never upload `.env.local`, development runner artifacts, or an unsanitized `.open-next` directory.

For the eventual build, set `NEXT_PUBLIC_SITE_URL` to the assigned origin. Public configuration is limited to the Supabase URL, publishable key and Site origin. Configure `SUPABASE_SECRET_KEY` and any enabled AI or Telegram credentials as server-only Sites runtime values. Do not upload the Supabase management access token or dummy staff password. Keep OCR/voice credentials distinct from browser configuration.

Deployment remains pending the owner's publishing instruction, frontend integration, secure runtime configuration and hosted verification. Photo enhancement and page import remain deferred.

References: [OpenNext Cloudflare setup](https://opennext.js.org/cloudflare/get-started), [environment variables](https://opennext.js.org/cloudflare/howtos/env-vars), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
