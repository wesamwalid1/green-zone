// Copies the local SQLite database (apps/api/prisma/dev.db) into a Turso (libSQL) database.
// Credentials come from TURSO_DATABASE_URL / TURSO_AUTH_TOKEN or the git-ignored .env.turso file.
// Usage: node scripts/copy-to-turso.mjs [--dry-run] [--replace]
//   --dry-run  only report what would be copied
//   --replace  drop existing tables on Turso first (otherwise refuses if data already exists)
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';

const root = new URL('..', import.meta.url);
const dryRun = process.argv.includes('--dry-run');
const replace = process.argv.includes('--replace');

const envFile = new URL('.env.turso', root);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const local = new DatabaseSync(new URL('apps/api/prisma/dev.db', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'), { readOnly: true });
const objects = local.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
const tables = objects.filter((o) => o.type === 'table').map((o) => o.name);

const deps = new Map(tables.map((t) => [t, new Set(
  local.prepare(`PRAGMA foreign_key_list("${t}")`).all().map((fk) => fk.table).filter((ref) => ref !== t && tables.includes(ref)),
)]));
const ordered = [];
const visit = (t, seen = new Set()) => {
  if (ordered.includes(t) || seen.has(t)) return;
  seen.add(t);
  for (const d of deps.get(t)) visit(d, seen);
  ordered.push(t);
};
tables.forEach((t) => visit(t));

const counts = Object.fromEntries(ordered.map((t) => [t, local.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
console.log(`${ordered.length} tables, ${Object.values(counts).reduce((a, b) => a + b, 0)} rows`);
if (dryRun) {
  console.log(Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => `${t}: ${n}`).join('\n'));
  process.exit(0);
}

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (.env.turso)');
  process.exit(1);
}
const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const existing = (await turso.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE 'libsql_%'")).rows.map((r) => r.name);
if (existing.length && !replace) {
  console.error(`Turso already has ${existing.length} tables. Re-run with --replace to overwrite.`);
  process.exit(1);
}
if (existing.length) {
  await turso.batch(['PRAGMA foreign_keys = OFF', ...existing.map((t) => `DROP TABLE IF EXISTS "${t}"`)], 'write');
}

await turso.batch(objects.filter((o) => o.type === 'table').map((o) => o.sql), 'write');
for (const t of ordered) {
  const rows = local.prepare(`SELECT * FROM "${t}"`).all();
  if (!rows.length) continue;
  const cols = Object.keys(rows[0]);
  const sql = `INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  for (let i = 0; i < rows.length; i += 200) {
    await turso.batch(rows.slice(i, i + 200).map((row) => ({ sql, args: cols.map((c) => row[c]) })), 'write');
  }
  process.stdout.write(`${t}: ${rows.length}\n`);
}
await turso.batch(objects.filter((o) => o.type !== 'table').map((o) => o.sql), 'write');

let mismatches = 0;
for (const t of ordered) {
  const n = Number((await turso.execute(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n);
  if (n !== counts[t]) { mismatches++; console.error(`MISMATCH ${t}: local ${counts[t]} vs turso ${n}`); }
}
console.log(mismatches ? `Done with ${mismatches} mismatches` : 'Done: all row counts match');
process.exit(mismatches ? 1 : 0);
