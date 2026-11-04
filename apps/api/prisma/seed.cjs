/* CommonJS seed usable by desktop first-run without tsx */
const { PrismaClient, Role, WarehouseKind } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.count();
    if (users > 0) {
      console.log('Seed skipped (users already exist)');
      return;
    }

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
      create: {
        code: 'RAW',
        name: 'مخزن خام',
        kind: WarehouseKind.RAW,
        description: 'مواد مشتراة / خام للتصنيع',
      },
      update: { kind: WarehouseKind.RAW, isActive: true },
    });
    await prisma.warehouse.upsert({
      where: { code: 'MFG' },
      create: {
        code: 'MFG',
        name: 'مخزن تصنيع',
        kind: WarehouseKind.MANUFACTURING,
        description: 'منتجات مصنّعة جاهزة',
      },
      update: { kind: WarehouseKind.MANUFACTURING, isActive: true },
    });
    await prisma.cashAccount.upsert({
      where: { code: 'CASH01' },
      create: { code: 'CASH01', name: 'الخزنة الرئيسية', balance: 0 },
      update: {},
    });
    console.log('Seed complete — login: admin / admin123');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

