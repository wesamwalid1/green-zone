/**
 * Sets Turso credentials on the linked Vercel project and copies the local schema/data.
 *
 * Usage:
 *   set TURSO_DATABASE_URL=libsql://...
 *   set TURSO_AUTH_TOKEN=...
 *   node scripts/setup-turso-vercel.mjs
 *
 * Or create .env.turso with those two keys, then run the script.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env.turso');

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) {
  console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN');
  console.error('Create a DB at https://turso.tech then put them in .env.turso');
  process.exit(1);
}

function run(cmd, args, input, { allowFail = false } = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    cwd: root,
    input,
    encoding: 'utf8',
    shell: true,
    env: process.env,
  });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0 && !allowFail) process.exit(res.status || 1);
  return res.status ?? 0;
}

for (const key of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN']) {
  for (const envName of ['production', 'preview']) {
    run('vercel', ['env', 'rm', key, envName, '--yes', '--scope', 'ahmedeid532003s-projects'], undefined, { allowFail: true });
  }
}

for (const envName of ['production', 'preview']) {
  run('vercel', ['env', 'add', 'TURSO_DATABASE_URL', envName, '--scope', 'ahmedeid532003s-projects'], `${url}\n`);
  run('vercel', ['env', 'add', 'TURSO_AUTH_TOKEN', envName, '--scope', 'ahmedeid532003s-projects'], `${token}\n`);
}

writeFileSync(envFile, `TURSO_DATABASE_URL="${url}"\nTURSO_AUTH_TOKEN="${token}"\n`, 'utf8');
console.log('\nCopying local schema/data to Turso...');
run('node', ['scripts/copy-to-turso.mjs', '--replace']);

console.log('\nRedeploying production...');
run('vercel', ['--prod', '--yes', '--scope', 'ahmedeid532003s-projects']);
console.log('\nDone.');
