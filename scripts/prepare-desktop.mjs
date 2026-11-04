/**
 * Prepares Electron desktop resources:
 * - builds web + api
 * - copies a runnable server pack (dist, prisma, prod node_modules, web)
 * - downloads portable Node for Windows into apps/desktop/node-runtime
 */
import { createWriteStream, existsSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const desktop = join(root, 'apps', 'desktop');
const serverPack = join(desktop, 'server-pack');
const nodeRuntime = join(desktop, 'node-runtime');
const nodeVersion = process.env.M5AZEN_NODE_VERSION || '20.18.1';

function run(cmd, cwd = root) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: process.env });
}

function copyDir(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

async function download(url, dest) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(res.body, createWriteStream(dest));
}

async function ensureWindowsNode() {
  const exe = join(nodeRuntime, 'node.exe');
  if (existsSync(exe)) {
    console.log('Portable Node already present');
    return;
  }
  if (process.platform !== 'win32') {
    console.log('Skipping portable Node download (non-Windows host). Packaged app expects Windows.');
    mkdirSync(nodeRuntime, { recursive: true });
    writeFileSync(join(nodeRuntime, 'README.txt'), 'On Windows build hosts, node.exe is downloaded here.\n');
    return;
  }

  const zipName = `node-v${nodeVersion}-win-x64`;
  const url = `https://nodejs.org/dist/v${nodeVersion}/${zipName}.zip`;
  const zipPath = join(desktop, `${zipName}.zip`);
  await download(url, zipPath);

  // Use PowerShell Expand-Archive (available on Windows)
  const extractTo = join(desktop, '_node_extract');
  rmSync(extractTo, { recursive: true, force: true });
  mkdirSync(extractTo, { recursive: true });
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractTo.replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit' },
  );
  rmSync(nodeRuntime, { recursive: true, force: true });
  mkdirSync(nodeRuntime, { recursive: true });
  cpSync(join(extractTo, zipName, 'node.exe'), exe);
  // optional: copy LICENSE
  const license = join(extractTo, zipName, 'LICENSE');
  if (existsSync(license)) cpSync(license, join(nodeRuntime, 'LICENSE'));
  rmSync(extractTo, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
  console.log('Portable Node ready');
}

function writeServerPackageJson() {
  const apiPkg = JSON.parse(readFileSync(join(root, 'apps', 'api', 'package.json'), 'utf8'));
  const deps = { ...apiPkg.dependencies };
  delete deps['@m5azen/shared'];
  // prisma CLI needed for first-run db push
  deps.prisma = apiPkg.devDependencies.prisma || '6.3.1';

  const pkg = {
    name: 'm5azen-desktop-server',
    version: apiPkg.version || '1.0.0',
    private: true,
    type: 'commonjs',
    main: 'dist/main.js',
    dependencies: deps,
  };
  writeFileSync(join(serverPack, 'package.json'), JSON.stringify(pkg, null, 2));
}

function writeSeedScript() {
  const seed = `/* first-run seed for desktop */
const { PrismaClient, Role, WarehouseKind } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.count();
    if (users > 0) return;

    const passwordHash = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: {
        username: 'admin',
        passwordHash,
        fullName: 'مدير النظام',
        role: Role.ADMIN,
      },
    });
    await prisma.setting.upsert({
      where: { key: 'companyName' },
      create: { key: 'companyName', value: 'Pro Pack' },
      update: {},
    });
    await prisma.warehouse.upsert({
      where: { code: 'RAW' },
      create: { code: 'RAW', name: 'مخزن خام', kind: WarehouseKind.RAW, description: 'مواد مشتراة / خام للتصنيع' },
      update: { kind: WarehouseKind.RAW, isActive: true },
    });
    await prisma.warehouse.upsert({
      where: { code: 'MFG' },
      create: { code: 'MFG', name: 'مخزن تصنيع', kind: WarehouseKind.MANUFACTURING, description: 'منتجات مصنّعة جاهزة' },
      update: { kind: WarehouseKind.MANUFACTURING, isActive: true },
    });
    await prisma.cashAccount.upsert({
      where: { code: 'CASH01' },
      create: { code: 'CASH01', name: 'الخزنة الرئيسية', balance: 0 },
      update: {},
    });
    console.log('Desktop seed complete (admin / admin123)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
  writeFileSync(join(serverPack, 'prisma', 'seed.cjs'), seed);
}

async function main() {
  console.log('=== Prepare desktop server pack ===');
  run('npm run build -w @m5azen/web');
  run('npm run build -w @m5azen/api');
  try {
    run('npm run db:generate');
  } catch (err) {
    const client = join(root, 'node_modules', '.prisma', 'client', 'query_engine-windows.dll.node');
    if (existsSync(client)) {
      console.warn('prisma generate locked — using existing Prisma client');
    } else {
      throw err;
    }
  }

  rmSync(serverPack, { recursive: true, force: true });
  mkdirSync(serverPack, { recursive: true });

  copyDir(join(root, 'apps', 'api', 'dist'), join(serverPack, 'dist'));
  copyDir(join(root, 'apps', 'api', 'prisma'), join(serverPack, 'prisma'));
  copyDir(join(root, 'apps', 'web', 'dist'), join(serverPack, 'web'));

  // لا تُشفّط أي قاعدة بيانات تطوير داخل نسخة الديسكتوب — أول تشغيل ينشئ DB فاضية
  for (const name of ['dev.db', 'dev.db-journal', 'data.db', 'data.db-journal', 'test.db']) {
    const p = join(serverPack, 'prisma', name);
    if (existsSync(p)) rmSync(p, { force: true });
  }
  // تأكد أن لوجو الواجهة/السبلاش هو لوجو Pro Pack
  const brandFull = join(root, 'apps', 'web', 'public', 'pro-pack-logo.png');
  const brandIcon = join(desktop, 'build', 'icon.png');
  if (existsSync(brandFull)) {
    copyDir(brandFull, join(serverPack, 'web', 'pro-pack-logo.png'));
  } else if (existsSync(brandIcon)) {
    copyDir(brandIcon, join(serverPack, 'web', 'pro-pack-logo.png'));
  }
  if (existsSync(brandIcon)) {
    copyDir(brandIcon, join(serverPack, 'web', 'favicon.png'));
  }

  writeServerPackageJson();
  writeSeedScript();

  // Ensure DATABASE_URL placeholder for prisma generate inside pack
  writeFileSync(
    join(serverPack, '.env'),
    [
      'DATABASE_URL="file:./data.db"',
      'JWT_SECRET="desktop-placeholder"',
      'JWT_EXPIRES_IN="30d"',
      'PORT=39101',
      'NODE_ENV=production',
    ].join('\n') + '\n',
  );

  run('npm install --omit=dev', serverPack);
  run('npx prisma generate', serverPack);

  await ensureWindowsNode();

  console.log('\nDesktop pack ready:');
  console.log(`  ${serverPack}`);
  console.log(`  ${nodeRuntime}`);
  console.log('\nNext: npm run dist -w @m5azen/desktop');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
