import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.setting.upsert({
    where: { key: 'companyName' },
    create: { key: 'companyName', value: 'Pro Pack' },
    update: { value: 'Pro Pack' },
  });
  console.log('company name updated');
}

main()
  .finally(() => prisma.$disconnect());
