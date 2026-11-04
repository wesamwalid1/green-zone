import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
await prisma.setting.upsert({
  where: { key: 'companyName' },
  create: { key: 'companyName', value: 'Pro Pack' },
  update: { value: 'Pro Pack' },
});
console.log('companyName = Pro Pack');
await prisma.$disconnect();
