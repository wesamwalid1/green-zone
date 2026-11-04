import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
await prisma.setting.upsert({
  where: { key: 'companyName' },
  create: { key: 'companyName', value: 'Green Zone' },
  update: { value: 'Green Zone' },
});
console.log('companyName = Green Zone');
await prisma.$disconnect();
