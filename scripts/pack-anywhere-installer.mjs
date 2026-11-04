/**
 * Builds an "install anywhere" package for Green Zone:
 * - copies win-unpacked -> release/GreenZone-Anywhere/app
 * - Arabic installer + direct launcher
 * - zips to GreenZone-Anywhere.zip
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'apps', 'desktop');
const unpacked = join(desktop, 'release', 'win-unpacked');
const outDir = join(desktop, 'release', 'GreenZone-Anywhere');
const zipPath = join(desktop, 'release', 'GreenZone-Anywhere.zip');

function findExe(dir) {
  for (const name of ['GreenZone.exe', 'Green Zone.exe', 'M5azen.exe']) {
    if (existsSync(join(dir, name))) return name;
  }
  return null;
}

const exeName = findExe(unpacked);
if (!exeName) {
  console.error('Missing win-unpacked. Run: npm run dist:dir -w @m5azen/desktop');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'app'), { recursive: true });
console.log(`Copying app (${exeName})...`);
cpSync(unpacked, join(outDir, 'app'), { recursive: true });
function writeUtf8Bom(filePath, text) {
  writeFileSync(filePath, `\uFEFF${text.replace(/^\uFEFF/, '')}`, 'utf8');
}

function writeUtf8NoBom(filePath, text) {
  // cmd.exe misreads UTF-8 BOM as garbage ('╗┐@echo')
  writeFileSync(filePath, Buffer.from(text.replace(/^\uFEFF/, ''), 'utf8'));
}

writeUtf8Bom(
  join(outDir, 'Install-GreenZone.ps1'),
  readFileSync(join(desktop, 'setup', 'Install-GreenZone.ps1'), 'utf8'),
);
writeUtf8NoBom(
  join(outDir, 'تثبيت.bat'),
  readFileSync(join(desktop, 'setup', 'تثبيت.bat'), 'utf8'),
);
writeUtf8NoBom(
  join(outDir, 'install.bat'),
  readFileSync(join(desktop, 'setup', 'تثبيت.bat'), 'utf8'),
);

writeUtf8NoBom(
  join(outDir, 'تشغيل.bat'),
  [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    `start "" "%~dp0app\\${exeName}"`,
  ].join('\r\n') + '\r\n',
);
writeUtf8NoBom(
  join(outDir, 'run.bat'),
  [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    `start "" "%~dp0app\\${exeName}"`,
  ].join('\r\n') + '\r\n',
);

writeUtf8Bom(
  join(outDir, 'اقرأني.txt'),
  [
    'Green Zone — نسخة ديسكتوب كاملة لأي جهاز ويندوز 64-bit',
    '',
    'الطريقة الأسهل:',
    '1) افتح: تثبيت.bat',
    '2) اختر أي مجلد (مثلاً C:\\GreenZone أو D:\\GreenZone)',
    '3) اضغط «تثبيت وتشغيل»',
    '',
    'بدون تثبيت:',
    '- شغّل: تشغيل.bat',
    `  أو مباشرة: app\\${exeName}`,
    '',
    'الدخول الافتراضي:',
    'admin / admin123',
    '',
    'ملاحظات:',
    '- لا يحتاج إنترنت ولا تثبيت Node',
    '- ويندوز 10/11 إصدار 64-bit',
    '- أول تشغيل قد يستغرق دقيقة حتى يفتح',
    '- النسخة بدون بيانات — فقط حساب admin',
    '',
  ].join('\r\n'),
);

const seven = join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
if (existsSync(zipPath)) rmSync(zipPath);
console.log('Zipping...');
try {
  if (existsSync(seven)) {
    execSync(`"${seven}" a -tzip -mx=1 "${zipPath}" "${join(outDir, '*')}"`, { stdio: 'inherit' });
  } else {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${outDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Fastest -Force"`,
      { stdio: 'inherit' },
    );
  }
} catch (err) {
  console.warn('Zip skipped:', err instanceof Error ? err.message : err);
}

console.log('\nReady:');
console.log(`  Folder: ${outDir}`);
if (existsSync(zipPath)) console.log(`  Zip:    ${zipPath}`);
