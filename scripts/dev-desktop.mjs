/**
 * Dev desktop: ensure API dist + web dist exist, point Electron at monorepo apps/api.
 * Uses system Node and local databases under Electron userData.
 */
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiMain = join(root, 'apps', 'api', 'dist', 'main.js');
const webIndex = join(root, 'apps', 'web', 'dist', 'index.html');

if (!existsSync(apiMain) || !existsSync(webIndex)) {
  console.error('Build first: npm run build:prod');
  process.exit(1);
}

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron', '.'],
  {
    cwd: join(root, 'apps', 'desktop'),
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    shell: process.platform === 'win32',
  },
);

child.on('exit', (code) => process.exit(code || 0));
