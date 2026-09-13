import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';

function run(command, args) {
  const child = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true' }, timeout: 180_000, killSignal: 'SIGKILL' });
  if (child.status !== 0) throw new Error('Worker build command failed.');
}

try {
  run('npx', ['opennextjs-cloudflare', 'build']);
  // OpenNext copies all local env files into this module by default. Runtime
  // values must come from Sites secrets, never the deployment archive.
  const envModule = '.open-next/cloudflare/next-env.mjs';
  const original = await readFile(envModule, 'utf8');
  if (!original.includes('export const production') || !original.includes('export const development')) throw new Error('Unrecognized OpenNext env module; stop before packaging.');
  await writeFile(envModule, 'export const production = {};\nexport const development = {};\nexport const test = {};\n', { mode: 0o600 });
  await rm('dist', { recursive: true, force: true });
  await mkdir('dist/server', { recursive: true });
  // The npm/bin wrapper can retain its IPC child after a successful dry run.
  // Execute the pinned local CLI directly and require a clean exit.
  run(process.execPath, ['node_modules/wrangler/wrangler-dist/cli.js', 'deploy', '--dry-run', '--config', 'wrangler.jsonc', '--no-autoconfig', '--outdir', 'dist/server']);
  await rename('dist/server/worker.js', 'dist/server/index.js');
  await cp('.open-next/assets', 'dist/client', { recursive: true });
  await mkdir('dist/.openai', { recursive: true });
  await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
  const env = await readFile('.env.local', 'utf8').catch(() => '');
  const secrets = env.split('\n').flatMap(line => {
    const split = line.indexOf('='); if (split < 1) return [];
    const key = line.slice(0, split), value = line.slice(split + 1).replace(/^["']|["']$/g, '');
    return /TOKEN|SECRET|PASSWORD|OPENAI_API_KEY/.test(key) && value.length > 12 ? [value] : [];
  });
  const scan = directory => {
    for (const name of readdirSync(directory)) {
      const path = `${directory}/${name}`;
      if (statSync(path).isDirectory()) scan(path);
      else {
        if (/^\.env(?:\.|$)/.test(name)) throw new Error('Environment file found in deployment output.');
        const bytes = readFileSync(path);
        if (secrets.some(secret => bytes.includes(Buffer.from(secret)))) throw new Error('Local credential found in deployment output.');
      }
    }
  };
  scan('dist');
  console.log('Sites Worker and static assets built; local credential scan passed.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Sites build failed.');
  process.exitCode = 1;
}
