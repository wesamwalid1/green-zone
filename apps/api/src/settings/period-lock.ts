import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function periodParts(input?: Date | string | null) {
  if (input == null || input === '') return periodParts(new Date());
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}/.test(input)) {
    return { year: Number(input.slice(0, 4)), month: Number(input.slice(5, 7)) };
  }
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('تاريخ غير صالح');
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).format(date);
  const [year, month] = formatted.split('-');
  return { year: Number(year), month: Number(month) };
}

export function periodLabel(year: number, month: number) {
  return `${MONTHS[month - 1] || month} ${year}`;
}

export async function assertPeriodsOpen(prisma: PrismaService, ...inputs: (Date | string | null | undefined)[]) {
  const keys = new Map<string, { year: number; month: number }>();
  for (const input of inputs) {
    const key = periodParts(input);
    keys.set(`${key.year}-${key.month}`, key);
  }
  for (const key of keys.values()) {
    const row = await prisma.fiscalPeriod.findUnique({
      where: { year_month: { year: key.year, month: key.month } },
    });
    if (row?.closedAt) {
      throw new BadRequestException(`شهر ${periodLabel(key.year, key.month)} مقفول. افتحه من الإعدادات واكتب السبب قبل التعديل`);
    }
  }
}
