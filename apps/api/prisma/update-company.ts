import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.setting.upsert({
    where: { key: 'companyName' },
    create: { key: 'companyName', value: 'Green Zone' },
    update: { value: 'Green Zone' },
  });
  console.log('company name updated');
}

main()
  .finally(() => prisma.$disconnect());
