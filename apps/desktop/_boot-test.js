const path = require('path');
const http = require('http');
const fs = require('fs');

const serverDir = path.join(__dirname, 'release', 'win-unpacked', 'resources', 'server');
const nodeModules = path.join(serverDir, 'node_modules');
process.chdir(serverDir);
module.paths.unshift(nodeModules);

process.env.NODE_ENV = 'production';
process.env.PORT = '39101';
process.env.HOST = '127.0.0.1';
process.env.DATABASE_URL = 'file:C:/Users/DELL/AppData/Roaming/@m5azen/desktop/m5azen.db';
process.env.JWT_SECRET = 'desktop-test-secret';
process.env.JWT_EXPIRES_IN = '30d';
process.env.WEB_DIST = path.join(serverDir, 'web');
process.env.ELECTRON_RUN = '1';

console.log('cwd', process.cwd());
console.log('index', fs.existsSync(path.join(process.env.WEB_DIST, 'index.html')));
console.log('main', fs.existsSync(path.join(serverDir, 'dist', 'main.js')));

const t0 = Date.now();
const tick = setInterval(() => console.log('still...', Date.now() - t0, 'ms'), 2000);

process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT', e && e.stack ? e.stack : e);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('UNHANDLED', e && e.stack ? e.stack : e);
  process.exit(1);
});

try {
  require(path.join(serverDir, 'dist', 'main.js'));
  console.log('require returned', Date.now() - t0, 'ms');
} catch (e) {
  clearInterval(tick);
  console.error('REQUIRE_FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
}

setTimeout(() => {
  http.get('http://127.0.0.1:39101/api/health', (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => {
      clearInterval(tick);
      console.log('HEALTH', res.statusCode, d);
      process.exit(0);
    });
  }).on('error', (e) => {
    clearInterval(tick);
    console.error('HEALTH_ERR', e.message);
    process.exit(2);
  });
}, 10000);
