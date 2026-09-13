import { mkdir, writeFile } from 'node:fs/promises';
const project = 'mikpepfrumtglwweolzq';
const site = 'https://jiak-simi-business-demo.elsenyong.chatgpt.site';
const required = [site + '/auth/confirm', 'http://localhost:3000/auth/confirm'];
async function request(suffix, patch) {
  if (!process.env.SUPABASE_ACCESS_TOKEN?.trim()) throw new Error('missing_management_token');
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}${suffix}`, { method: patch ? 'PATCH' : 'GET', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, ...(patch ? { body: JSON.stringify(patch) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('management_request_failed');
  return response.json();
}
try {
  if (process.argv.slice(2).join(' ') !== '--apply') throw new Error('apply_flag_required');
  const info = await request('');
  if (info.ref !== project || info.status !== 'ACTIVE_HEALTHY') throw new Error('wrong_project_or_health');
  const before = await request('/config/auth');
  if (typeof before.site_url !== 'string' || typeof before.uri_allow_list !== 'string') throw new Error('unrecognized_auth_url_config');
  const previous = before.uri_allow_list.split(',').map(value => value.trim()).filter(Boolean);
  const combined = [...new Set([...previous, ...required])];
  const changed = before.site_url !== site || required.some(value => !previous.includes(value));
  if (changed) await request('/config/auth', { site_url: site, uri_allow_list: combined.join(',') });
  const after = await request('/config/auth');
  if (typeof after.uri_allow_list !== 'string') throw new Error('verification_unconfirmed');
  const current = after.uri_allow_list.split(',').map(value => value.trim()).filter(Boolean);
  if (after.site_url !== site || [...previous, ...required].some(value => !current.includes(value)) || after.mailer_autoconfirm !== before.mailer_autoconfirm) throw new Error('verification_unconfirmed');
  const evidence = { status: 'staging_auth_urls_verified', project, changed, siteUrl: site, requiredRedirectUrls: required, existingRedirectEntriesPreserved: previous.length, unrelatedRedirectEntries: current.filter(value => !required.includes(value)).length, emailConfirmationSettingUnchanged: true, emailSent: false, verifiedAt: new Date().toISOString() };
  await mkdir('artifacts/deployment', { recursive: true });
  await writeFile('artifacts/deployment/staging-auth-urls.json', JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} catch (error) {
  console.error(JSON.stringify({ status: 'stopped', code: error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'outcome_unknown_read_config_before_retry' })); process.exitCode = 1;
}
