import { BadRequestException } from '@nestjs/common';

export type HrSettings = {
  daysPerMonth: number;
  hoursPerDay: number;
  weekendDays: number[];
  lateGraceMinutes: number;
  /** @deprecated — التأخير يُحسب بسعر الساعة من المرتب */
  latePenaltyPerMinute: number;
  permissionDeductPerHour: number;
  workStartHour: number;
  workStartMinute: number;
  /** الإضافي: ساعة بساعتين = 2 */
  overtimeMultiplier: number;
  /** الغياب: يوم بيوم = 1 · يوم بيومين = 2 */
  absenceMultiplier: number;
  /** الإجازة غير المدفوعة: خصم يوم بيوم */
  unpaidLeaveDeduct: boolean;
  /** التأخير: تجميع دقائق الشهر وخصم بسعر الساعة */
  lateByHourlyRate: boolean;
};

export const DEFAULT_HR_SETTINGS: HrSettings = {
  daysPerMonth: 30,
  hoursPerDay: 8,
  weekendDays: [5, 6],
  lateGraceMinutes: 15,
  latePenaltyPerMinute: 0,
  permissionDeductPerHour: 0,
  workStartHour: 9,
  workStartMinute: 0,
  overtimeMultiplier: 2,
  absenceMultiplier: 1,
  unpaidLeaveDeduct: true,
  lateByHourlyRate: true,
};

export const HR_SETTINGS_KEY = 'hr.settings';
export const SALARY_EXPENSE_CATEGORY = 'رواتب';

export function roundMoney(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function parseHrSettings(raw: string | null | undefined): HrSettings {
  if (!raw) return { ...DEFAULT_HR_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<HrSettings>;
    const absenceMultiplier = Number(parsed.absenceMultiplier);
    return {
      daysPerMonth: Math.max(1, Number(parsed.daysPerMonth) || DEFAULT_HR_SETTINGS.daysPerMonth),
      hoursPerDay: Math.max(1, Number(parsed.hoursPerDay) || DEFAULT_HR_SETTINGS.hoursPerDay),
      weekendDays: Array.isArray(parsed.weekendDays)
        ? parsed.weekendDays.map(Number).filter((d) => d >= 0 && d <= 6)
        : DEFAULT_HR_SETTINGS.weekendDays,
      lateGraceMinutes: Math.max(0, Number(parsed.lateGraceMinutes) || 0),
      latePenaltyPerMinute: Math.max(0, Number(parsed.latePenaltyPerMinute) || 0),
      permissionDeductPerHour: Math.max(0, Number(parsed.permissionDeductPerHour) || 0),
      workStartHour: Math.min(23, Math.max(0, Number(parsed.workStartHour) ?? DEFAULT_HR_SETTINGS.workStartHour)),
      workStartMinute: Math.min(59, Math.max(0, Number(parsed.workStartMinute) ?? DEFAULT_HR_SETTINGS.workStartMinute)),
      overtimeMultiplier: Math.max(1, Number(parsed.overtimeMultiplier) || DEFAULT_HR_SETTINGS.overtimeMultiplier),
      absenceMultiplier: absenceMultiplier === 2 ? 2 : 1,
      unpaidLeaveDeduct: parsed.unpaidLeaveDeduct !== false,
      lateByHourlyRate: parsed.lateByHourlyRate !== false,
    };
  } catch {
    return { ...DEFAULT_HR_SETTINGS };
  }
}

/** YYYY-MM-DD in Africa/Cairo */
export function cairoYmd(input?: Date | string | null) {
  if (input == null || input === '') return cairoYmd(new Date());
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}/.test(input)) return input.slice(0, 10);
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('تاريخ غير صالح');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Store date-only as UTC noon so day never shifts across zones */
export function dateOnly(input: Date | string) {
  const ymd = cairoYmd(input);
  return new Date(`${ymd}T12:00:00.000Z`);
}

export function parseRange(from?: string, to?: string) {
  if (!from || !to) throw new BadRequestException('حدد تاريخ البداية والنهاية');
  const fromDate = dateOnly(from);
  const toDate = dateOnly(to);
  if (fromDate.getTime() > toDate.getTime()) throw new BadRequestException('تاريخ البداية بعد النهاية');
  return { fromDate, toDate, fromYmd: cairoYmd(fromDate), toYmd: cairoYmd(toDate) };
}

export function eachYmd(fromYmd: string, toYmd: string) {
  const out: string[] = [];
  let cur = dateOnly(fromYmd);
  const end = dateOnly(toYmd).getTime();
  while (cur.getTime() <= end) {
    out.push(cairoYmd(cur));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

/** JS weekday 0=Sun … 6=Sat for a YYYY-MM-DD (Cairo calendar day) */
export function weekdayOfYmd(ymd: string) {
  return dateOnly(ymd).getUTCDay();
}

export function isWeekend(ymd: string, weekendDays: number[]) {
  return weekendDays.includes(weekdayOfYmd(ymd));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function nextSeq(tx: any, key: string, prefix: string) {
  const seq = await tx.sequence.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${String(seq.value).padStart(6, '0')}`;
}
