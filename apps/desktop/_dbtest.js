const path = require('path');
process.chdir(path.join(__dirname, 'release/win-unpacked/resources/server'));
process.env.DATABASE_URL = 'file:C:/Users/DELL/AppData/Roaming/@m5azen/desktop/m5azen.db';
const { PrismaClient } = require('./release/win-unpacked/resources/server/node_modules/@prisma/client');
const p = new PrismaClient();
p.$queryRawUnsafe('SELECT 1 as x')
  .then((r) => { console.log('DB_OK', JSON.stringify(r)); return p.$disconnect(); })
  .then(() => process.exit(0))
  .catch((e) => { console.error('DB_FAIL', e && e.stack ? e.stack : e); process.exit(1); });
setTimeout(() => { console.error('DB_TIMEOUT'); process.exit(2); }, 12000);
