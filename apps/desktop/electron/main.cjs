const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.M5AZEN_PORT || 39101);
const HOST = '127.0.0.1';

// مسار بيانات نظيف باسم ProPack (مش مجلد @m5azen القديم)
try {
  app.setName('ProPack');
  app.setPath('userData', path.join(app.getPath('appData'), 'ProPack'));
} catch {
  /* before ready is fine on Electron 35 */
}

let mainWindow = null;
let splashWindow = null;
let serverProc = null;
let stopping = false;

function userPaths() {
  const root = app.getPath('userData');
  return {
    root,
    db: path.join(root, 'm5azen.db'),
    jwtFile: path.join(root, 'jwt.secret'),
    logFile: path.join(root, 'server.log'),
  };
}

function ensureJwtSecret() {
  const { jwtFile, root } = userPaths();
  fs.mkdirSync(root, { recursive: true });
  if (fs.existsSync(jwtFile)) return fs.readFileSync(jwtFile, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(jwtFile, secret, 'utf8');
  return secret;
}

function repoRoot() {
  return path.resolve(__dirname, '../../..');
}

function serverDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'server');
  return path.join(repoRoot(), 'apps', 'api');
}

function webDistDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'server', 'web');
  return path.join(repoRoot(), 'apps', 'web', 'dist');
}

function iconFile() {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const candidates = [
    path.join(process.resourcesPath || '', file),
    path.join(__dirname, '..', 'build', file),
    path.join(__dirname, '..', 'build', 'icon.png'),
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

function resolveNodeBinary() {
  if (app.isPackaged) {
    const bundled = path.join(
      process.resourcesPath,
      'node',
      process.platform === 'win32' ? 'node.exe' : 'node',
    );
    if (fs.existsSync(bundled)) return bundled;
  }
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

function appendLog(line) {
  try {
    fs.appendFileSync(userPaths().logFile, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* ignore */
  }
}

function freePort(port) {
  if (process.platform !== 'win32') return;
  try {
    const out = spawnSync('cmd', ['/c', `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port} ^| findstr LISTENING') do taskkill /F /PID %a`], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 6000,
    });
    if (out.stdout) appendLog(`freePort ${port}: ${String(out.stdout).trim()}`);
  } catch (e) {
    appendLog(`freePort warn: ${e instanceof Error ? e.message : e}`);
  }
}

function waitForHealth(timeoutMs = 180000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://${HOST}:${PORT}/api/health`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.setTimeout(2500, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (stopping) return reject(new Error('cancelled'));
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('انتهت مهلة تشغيل الخادم المحلي — أعد المحاولة أو راجع السجل'));
      }
      setTimeout(tick, 500);
    };
    tick();
  });
}

function buildEnv(dbUrl) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    HOST,
    DATABASE_URL: dbUrl,
    JWT_SECRET: ensureJwtSecret(),
    JWT_EXPIRES_IN: '30d',
    WEB_DIST: webDistDir(),
    ELECTRON_RUN: '1',
  };
  // امنع وراثة إعدادات Electron / السحابة اللي بتعطل node المستقل
  for (const key of [
    'TURSO_DATABASE_URL',
    'TURSO_AUTH_TOKEN',
    'TURSO_URL',
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_NO_ASAR',
    'ELECTRON_NO_ATTACH_CONSOLE',
    'NODE_OPTIONS',
  ]) {
    delete env[key];
  }
  return env;
}

function resolvePrismaCli(dir) {
  const candidates = [
    path.join(dir, 'node_modules', 'prisma', 'build', 'index.js'),
    path.join(repoRoot(), 'node_modules', 'prisma', 'build', 'index.js'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function ensureDatabase(nodeBin, dir, env) {
  const { db } = userPaths();
  const fresh = !fs.existsSync(db) || fs.statSync(db).size < 64;
  const prismaCli = resolvePrismaCli(dir);
  if (!prismaCli) {
    throw new Error('Prisma غير موجود داخل الحزمة');
  }

  // دائمًا: حدّث المخطط (يضيف جداول التصنيع الجديدة بدون مسح البيانات القديمة)
  appendLog(fresh ? 'initializing database schema' : 'syncing database schema');
  const push = spawnSync(nodeBin, [prismaCli, 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: dir,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (push.status !== 0) {
    appendLog(push.stdout || '');
    appendLog(push.stderr || '');
    throw new Error('تعذر تهيئة قاعدة البيانات');
  }
  appendLog(push.stdout || 'schema synced');

  if (!fresh) return;

  const seedJs = path.join(dir, 'prisma', 'seed.cjs');
  if (fs.existsSync(seedJs)) {
    const seeded = spawnSync(nodeBin, [seedJs], { cwd: dir, env, encoding: 'utf8', windowsHide: true });
    appendLog(seeded.stdout || '');
    appendLog(seeded.stderr || '');
  }
}

function startServer() {
  const dir = serverDir();
  const entry = path.join(dir, 'dist', 'main.js');
  if (!fs.existsSync(entry)) {
    throw new Error(`لم يتم العثور على خادم التطبيق:\n${entry}`);
  }

  const paths = userPaths();
  const dbUrl = `file:${paths.db.replace(/\\/g, '/')}`;
  const env = buildEnv(dbUrl);
  const nodeBin = resolveNodeBinary();
  if (!fs.existsSync(nodeBin) && app.isPackaged) {
    throw new Error(`Node غير موجود:\n${nodeBin}`);
  }

  freePort(PORT);
  ensureDatabase(nodeBin, dir, env);

  appendLog(`starting ${nodeBin} ${entry}`);
  appendLog(`cwd=${dir} db=${dbUrl}`);

  // كتابة اللوج مباشرة للملف — تفادي تعليق الخادم بسبب امتلاء stdout pipe
  const logFd = fs.openSync(paths.logFile, 'a');
  serverProc = spawn(nodeBin, [entry], {
    cwd: dir,
    env,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  fs.closeSync(logFd);

  serverProc.on('exit', (code, signal) => {
    appendLog(`server exit code=${code} signal=${signal}`);
    serverProc = null;
    if (!stopping && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('توقف الخادم', 'توقف الخادم المحلي فجأة. راجع السجل أو أعد فتح التطبيق.');
    }
  });
}

function stopServer() {
  stopping = true;
  if (!serverProc) return;
  const proc = serverProc;
  serverProc = null;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true });
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }
}

function showSplash() {
  const icon = iconFile();
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    center: true,
    show: true,
    backgroundColor: '#0f1c2e',
    icon,
    webPreferences: { sandbox: true },
  });
  const logoSrc = app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'web', 'pro-pack-logo.png').replace(/\\/g, '/')
    : path.join(repoRoot(), 'apps', 'web', 'public', 'pro-pack-logo.png').replace(/\\/g, '/');
  const html = `<!doctype html><html dir="rtl"><body style="margin:0;font-family:Segoe UI,Tahoma,sans-serif;background:#0f1c2e;color:#fff;display:grid;place-items:center;height:100vh">
    <div style="text-align:center;padding:24px">
      <img src="file:///${logoSrc}" alt="Pro Pack" style="width:88px;height:88px;border-radius:18px;background:#f4f0e8;object-fit:contain"/>
      <div style="margin-top:16px;font-size:22px;font-weight:800">Pro Pack</div>
      <div style="margin-top:8px;opacity:.85;font-size:13px">جاري تشغيل النظام...</div>
      <div style="margin:18px auto 0;width:180px;height:4px;border-radius:99px;background:#1e293b;overflow:hidden">
        <div style="width:40%;height:100%;background:#38bdf8;animation:a 1.2s infinite alternate"></div>
      </div>
    </div>
    <style>@keyframes a{from{transform:translateX(0)}to{transform:translateX(150%)}}</style>
  </body></html>`;
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'Pro Pack',
    icon: iconFile(),
    show: false,
    backgroundColor: '#0f1c2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    closeSplash();
    mainWindow?.show();
    mainWindow?.focus();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(`http://${HOST}:${PORT}`);
}

async function boot() {
  try {
    showSplash();
    startServer();
    await waitForHealth(180000);
    createWindow();
  } catch (err) {
    closeSplash();
    appendLog(`boot failed: ${err instanceof Error ? err.message : err}`);
    dialog.showErrorBox(
      'تعذر تشغيل Pro Pack',
      `${err instanceof Error ? err.message : String(err)}\n\nسجل التشغيل:\n${userPaths().logFile}`,
    );
    stopServer();
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(boot);

  app.on('before-quit', () => stopServer());
  app.on('window-all-closed', () => {
    stopServer();
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });
}
