import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.cashAccount.upsert({
    where: { code: 'BANK01' },
    create: { code: 'BANK01', name: 'البنك الأهلي', accountType: 'BANK', balance: 0 },
    update: { accountType: 'BANK' },
  });
  await prisma.cashAccount.updateMany({
    where: { code: 'CASH01' },
    data: { accountType: 'CASH' },
  });
  console.log('accounts ready');
}

main().finally(() => prisma.$disconnect());
