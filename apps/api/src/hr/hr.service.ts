import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  HrAttendanceStatus,
  HrLeaveKind,
  HrLeaveStatus,
  HrMovementKind,
  HrPayrollStatus,
  InvoiceStatus,
  PayMethodKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertPeriodsOpen } from '../settings/period-lock';
import {
  cairoYmd,
  dateOnly,
  DEFAULT_HR_SETTINGS,
  eachYmd,
  HR_SETTINGS_KEY,
  isWeekend,
  nextSeq,
  parseHrSettings,
  parseRange,
  roundMoney,
  SALARY_EXPENSE_CATEGORY,
  type HrSettings,
} from './hr.util';

type CalcLineInput = {
  employeeId?: string;
  employeeIds?: string[];
  from: string;
  to: string;
};

@Injectable()
export class HrService {
  constructor(private prisma: PrismaService) {}

  // ─── settings ─────────────────────────────────────────────
  async getSettings(): Promise<HrSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: HR_SETTINGS_KEY } });
    return parseHrSettings(row?.value);
  }

  async patchSettings(patch: Partial<HrSettings>) {
    const current = await this.getSettings();
    const absenceMultiplier = Number(patch.absenceMultiplier ?? current.absenceMultiplier);
    const next: HrSettings = {
      ...current,
      ...patch,
      daysPerMonth: Math.max(1, Number(patch.daysPerMonth ?? current.daysPerMonth)),
      hoursPerDay: Math.max(1, Number(patch.hoursPerDay ?? current.hoursPerDay)),
      weekendDays: Array.isArray(patch.weekendDays)
        ? patch.weekendDays.map(Number).filter((d) => d >= 0 && d <= 6)
        : current.weekendDays,
      lateGraceMinutes: Math.max(0, Number(patch.lateGraceMinutes ?? current.lateGraceMinutes)),
      latePenaltyPerMinute: Math.max(0, Number(patch.latePenaltyPerMinute ?? current.latePenaltyPerMinute)),
      permissionDeductPerHour: Math.max(0, Number(patch.permissionDeductPerHour ?? current.permissionDeductPerHour)),
      workStartHour: Math.min(23, Math.max(0, Number(patch.workStartHour ?? current.workStartHour))),
      workStartMinute: Math.min(59, Math.max(0, Number(patch.workStartMinute ?? current.workStartMinute))),
      overtimeMultiplier: Math.max(1, Number(patch.overtimeMultiplier ?? current.overtimeMultiplier)),
      absenceMultiplier: absenceMultiplier === 2 ? 2 : 1,
      unpaidLeaveDeduct: patch.unpaidLeaveDeduct ?? current.unpaidLeaveDeduct,
      lateByHourlyRate: patch.lateByHourlyRate ?? current.lateByHourlyRate,
    };
    await this.prisma.setting.upsert({
      where: { key: HR_SETTINGS_KEY },
      create: { key: HR_SETTINGS_KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    return next;
  }

  // ─── holidays ─────────────────────────────────────────────
  listHolidays() {
    return this.prisma.hrHoliday.findMany({ orderBy: { date: 'asc' } });
  }

  async createHoliday(data: { date: string; name: string }) {
    const date = dateOnly(data.date);
    try {
      return await this.prisma.hrHoliday.create({
        data: { date, name: data.name.trim() },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('هذا اليوم مسجل كإجازة رسمية بالفعل');
      }
      throw e;
    }
  }

  async deleteHoliday(id: string) {
    await this.prisma.hrHoliday.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('الإجازة غير موجودة');
    });
    return { ok: true };
  }

  // ─── employees ────────────────────────────────────────────
  listEmployees(q?: string) {
    const where: Prisma.HrEmployeeWhereInput = q
      ? {
          OR: [
            { code: { contains: q } },
            { name: { contains: q } },
            { phone: { contains: q } },
          ],
        }
      : {};
    return this.prisma.hrEmployee.findMany({
      where,
      include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
      orderBy: { code: 'asc' },
    });
  }

  async getEmployee(id: string) {
    const row = await this.prisma.hrEmployee.findUnique({
      where: { id },
      include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
    });
    if (!row) throw new NotFoundException('الموظف غير موجود');
    return row;
  }

  async createEmployee(data: {
    code?: string;
    name: string;
    userId?: string | null;
    salary?: number;
    commissionPercent?: number;
    phone?: string;
    hireDate?: string;
    notes?: string;
    isActive?: boolean;
  }) {
    const code = (data.code || '').trim() || `E${Date.now().toString(36).toUpperCase()}`;
    const name = data.name.trim();
    if (!name) throw new BadRequestException('اسم الموظف مطلوب');
    if (data.userId) await this.assertUserLinkable(data.userId);
    try {
      return await this.prisma.hrEmployee.create({
        data: {
          code,
          name,
          userId: data.userId || null,
          salary: Math.max(0, Number(data.salary) || 0),
          commissionPercent: Math.max(0, Number(data.commissionPercent) || 0),
          phone: data.phone?.trim() || null,
          hireDate: data.hireDate ? dateOnly(data.hireDate) : null,
          notes: data.notes?.trim() || null,
          isActive: data.isActive !== false,
        },
        include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('كود الموظف أو المستخدم مربوط مسبقاً');
      }
      throw e;
    }
  }

  async updateEmployee(
    id: string,
    data: Partial<{
      code: string;
      name: string;
      userId: string | null;
      salary: number;
      commissionPercent: number;
      phone: string | null;
      hireDate: string | null;
      notes: string | null;
      isActive: boolean;
    }>,
  ) {
    await this.getEmployee(id);
    if (data.userId) await this.assertUserLinkable(data.userId, id);
    try {
      return await this.prisma.hrEmployee.update({
        where: { id },
        data: {
          ...(data.code != null ? { code: data.code.trim() } : {}),
          ...(data.name != null ? { name: data.name.trim() } : {}),
          ...(data.userId !== undefined ? { userId: data.userId || null } : {}),
          ...(data.salary != null ? { salary: Math.max(0, Number(data.salary) || 0) } : {}),
          ...(data.commissionPercent != null
            ? { commissionPercent: Math.max(0, Number(data.commissionPercent) || 0) }
            : {}),
          ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
          ...(data.hireDate !== undefined
            ? { hireDate: data.hireDate ? dateOnly(data.hireDate) : null }
            : {}),
          ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
          ...(data.isActive != null ? { isActive: !!data.isActive } : {}),
        },
        include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('كود الموظف أو المستخدم مربوط مسبقاً');
      }
      throw e;
    }
  }

  async deleteEmployee(id: string) {
    const lines = await this.prisma.hrPayrollLine.count({ where: { employeeId: id } });
    if (lines) throw new BadRequestException('لا يمكن حذف موظف له كشوف مرتبات');
    await this.prisma.hrEmployee.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('الموظف غير موجود');
    });
    return { ok: true };
  }

  async linkableUsers() {
    const linked = await this.prisma.hrEmployee.findMany({
      where: { userId: { not: null } },
      select: { userId: true },
    });
    const used = new Set(linked.map((r) => r.userId!).filter(Boolean));
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    });
    return users.map((u) => ({ ...u, linked: used.has(u.id) }));
  }

  private async assertUserLinkable(userId: string, exceptEmployeeId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new BadRequestException('المستخدم غير موجود أو موقوف');
    const other = await this.prisma.hrEmployee.findFirst({
      where: { userId, ...(exceptEmployeeId ? { id: { not: exceptEmployeeId } } : {}) },
    });
    if (other) throw new BadRequestException('هذا المستخدم مربوط بموظف آخر');
  }

  // ─── leaves ───────────────────────────────────────────────
  listLeaves(employeeId?: string) {
    return this.prisma.hrLeave.findMany({
      where: {
        ...(employeeId ? { employeeId } : {}),
        status: HrLeaveStatus.APPROVED,
      },
      include: { employee: { select: { id: true, code: true, name: true } } },
      orderBy: { fromDate: 'desc' },
    });
  }

  async createLeave(data: {
    employeeId: string;
    fromDate: string;
    toDate: string;
    kind?: HrLeaveKind;
    notes?: string;
  }) {
    await this.getEmployee(data.employeeId);
    const { fromDate, toDate } = parseRange(data.fromDate, data.toDate);
    return this.prisma.hrLeave.create({
      data: {
        employeeId: data.employeeId,
        fromDate,
        toDate,
        kind: data.kind === HrLeaveKind.UNPAID ? HrLeaveKind.UNPAID : HrLeaveKind.PAID,
        status: HrLeaveStatus.APPROVED,
        notes: data.notes?.trim() || null,
      },
      include: { employee: { select: { id: true, code: true, name: true } } },
    });
  }

  async deleteLeave(id: string) {
    await this.prisma.hrLeave.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('الإجازة غير موجودة');
    });
    return { ok: true };
  }

  // ─── movements ────────────────────────────────────────────
  listMovements(query?: { employeeId?: string; unsettled?: string; from?: string; to?: string }) {
    const where: Prisma.HrMovementWhereInput = {};
    if (query?.employeeId) where.employeeId = query.employeeId;
    if (query?.unsettled === '1') where.payrollRunId = null;
    if (query?.from || query?.to) {
      where.movementDate = {};
      if (query.from) where.movementDate.gte = dateOnly(query.from);
      if (query.to) where.movementDate.lte = dateOnly(query.to);
    }
    return this.prisma.hrMovement.findMany({
      where,
      include: { employee: { select: { id: true, code: true, name: true } } },
      orderBy: { movementDate: 'desc' },
    });
  }

  async createMovement(data: {
    employeeId: string;
    kind: HrMovementKind;
    amount: number;
    movementDate?: string;
    notes?: string;
  }) {
    await this.getEmployee(data.employeeId);
    if (!Object.values(HrMovementKind).includes(data.kind)) {
      throw new BadRequestException('نوع الحركة غير صالح');
    }
    const amount = roundMoney(Math.abs(Number(data.amount) || 0));
    if (amount <= 0) throw new BadRequestException('المبلغ لازم يكون أكبر من صفر');
    return this.prisma.hrMovement.create({
      data: {
        employeeId: data.employeeId,
        kind: data.kind,
        amount,
        movementDate: data.movementDate ? dateOnly(data.movementDate) : dateOnly(new Date()),
        notes: data.notes?.trim() || null,
      },
      include: { employee: { select: { id: true, code: true, name: true } } },
    });
  }

  async deleteMovement(id: string) {
    const row = await this.prisma.hrMovement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('الحركة غير موجودة');
    if (row.payrollRunId) throw new BadRequestException('الحركة مسوّاة ضمن كشف مرتبات ولا تُحذف');
    await this.prisma.hrMovement.delete({ where: { id } });
    return { ok: true };
  }

  // ─── attendance ───────────────────────────────────────────
  listAttendance(query?: { from?: string; to?: string; employeeId?: string }) {
    const where: Prisma.HrAttendanceWhereInput = {};
    if (query?.employeeId) where.employeeId = query.employeeId;
    if (query?.from || query?.to) {
      where.workDate = {};
      if (query.from) where.workDate.gte = dateOnly(query.from);
      if (query.to) where.workDate.lte = dateOnly(query.to);
    }
    return this.prisma.hrAttendance.findMany({
      where,
      include: { employee: { select: { id: true, code: true, name: true } } },
      orderBy: [{ workDate: 'desc' }, { employee: { code: 'asc' } }],
    });
  }

  async upsertAttendance(data: {
    employeeId: string;
    workDate: string;
    status?: HrAttendanceStatus;
    punchIn?: string | null;
    punchOut?: string | null;
    lateMinutes?: number;
    permissionMinutes?: number;
    overtimeMinutes?: number;
    notes?: string;
  }) {
    await this.getEmployee(data.employeeId);
    const workDate = dateOnly(data.workDate);
    const settings = await this.getSettings();
    let lateMinutes = Math.max(0, Number(data.lateMinutes) || 0);
    let permissionMinutes = Math.max(0, Number(data.permissionMinutes) || 0);
    let overtimeMinutes = Math.max(0, Number(data.overtimeMinutes) || 0);
    let punchIn: Date | null = data.punchIn ? new Date(data.punchIn) : null;
    let punchOut: Date | null = data.punchOut ? new Date(data.punchOut) : null;
    if (punchIn && Number.isNaN(punchIn.getTime())) punchIn = null;
    if (punchOut && Number.isNaN(punchOut.getTime())) punchOut = null;

    // لو الحضور/الانصراف موجودين ومتبعتش إضافي يدوي → احسب ساعات العمل والإضافي
    if (punchIn && punchOut && (data.overtimeMinutes == null || data.overtimeMinutes === undefined)) {
      const workedMins = Math.max(0, Math.round((punchOut.getTime() - punchIn.getTime()) / 60000));
      const expectedMins = Math.max(1, settings.hoursPerDay) * 60;
      overtimeMinutes = Math.max(0, workedMins - expectedMins);
    }

    let status = data.status || HrAttendanceStatus.PRESENT;
    if (punchIn && (data.lateMinutes == null || data.lateMinutes === undefined)) {
      lateMinutes = this.calcLateMinutes(punchIn, workDate, settings);
    }
    if (status === HrAttendanceStatus.PRESENT && lateMinutes > settings.lateGraceMinutes) {
      status = HrAttendanceStatus.LATE;
    }

    return this.prisma.hrAttendance.upsert({
      where: { employeeId_workDate: { employeeId: data.employeeId, workDate } },
      create: {
        employeeId: data.employeeId,
        workDate,
        status,
        punchIn,
        punchOut,
        lateMinutes,
        permissionMinutes,
        overtimeMinutes,
        notes: data.notes?.trim() || null,
      },
      update: {
        status,
        punchIn,
        punchOut,
        lateMinutes,
        permissionMinutes,
        overtimeMinutes,
        notes: data.notes?.trim() || null,
      },
      include: { employee: { select: { id: true, code: true, name: true } } },
    });
  }

  async deleteAttendance(id: string) {
    await this.prisma.hrAttendance.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('سجل الحضور غير موجود');
    });
    return { ok: true };
  }

  async punchIn(employeeId: string, at?: string) {
    const when = at ? new Date(at) : new Date();
    if (Number.isNaN(when.getTime())) throw new BadRequestException('وقت غير صالح');
    const ymd = cairoYmd(when);
    const settings = await this.getSettings();
    const workDate = dateOnly(ymd);
    const lateMinutes = this.calcLateMinutes(when, workDate, settings);
    const status =
      lateMinutes > settings.lateGraceMinutes ? HrAttendanceStatus.LATE : HrAttendanceStatus.PRESENT;
    return this.upsertAttendance({
      employeeId,
      workDate: ymd,
      punchIn: when.toISOString(),
      status,
      lateMinutes,
    });
  }

  async punchOut(employeeId: string, at?: string) {
    const when = at ? new Date(at) : new Date();
    if (Number.isNaN(when.getTime())) throw new BadRequestException('وقت غير صالح');
    const ymd = cairoYmd(when);
    const existing = await this.prisma.hrAttendance.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: dateOnly(ymd) } },
    });
    if (!existing?.punchIn) {
      throw new BadRequestException('لا يوجد تسجيل حضور لهذا اليوم');
    }
    return this.upsertAttendance({
      employeeId,
      workDate: ymd,
      punchIn: existing.punchIn.toISOString(),
      punchOut: when.toISOString(),
      status: existing.status,
      lateMinutes: existing.lateMinutes,
      permissionMinutes: existing.permissionMinutes,
      notes: existing.notes || undefined,
    });
  }

  private calcLateMinutes(punchIn: Date, workDate: Date, settings: HrSettings) {
    const ymd = cairoYmd(workDate);
    const start = new Date(
      `${ymd}T${String(settings.workStartHour).padStart(2, '0')}:${String(settings.workStartMinute).padStart(2, '0')}:00`,
    );
    // interpret work start in local/Cairo wall clock approx via ISO without Z → local; fallback minutes via cairo parts
    const punchParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(punchIn);
    const ph = Number(punchParts.find((p) => p.type === 'hour')?.value || 0);
    const pm = Number(punchParts.find((p) => p.type === 'minute')?.value || 0);
    const punchMins = ph * 60 + pm;
    const startMins = settings.workStartHour * 60 + settings.workStartMinute;
    const diff = punchMins - startMins - settings.lateGraceMinutes;
    return Math.max(0, diff);
    void start;
  }

  // ─── commission report ────────────────────────────────────
  async commissionsReport(from?: string, to?: string) {
    const { fromDate, toDate, fromYmd, toYmd } = parseRange(
      from || cairoYmd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
      to || cairoYmd(new Date()),
    );
    const employees = await this.prisma.hrEmployee.findMany({
      where: { isActive: true },
      include: { user: { select: { id: true, fullName: true, username: true } } },
      orderBy: { code: 'asc' },
    });
    const rows = [];
    for (const emp of employees) {
      const salesTotal = await this.salesTotalFor(emp.userId, fromDate, toDate);
      const commissionEarned = roundMoney(salesTotal * ((emp.commissionPercent || 0) / 100));
      const paid = await this.commissionPaidExact(emp.id, fromDate, toDate);
      const remaining = roundMoney(Math.max(0, commissionEarned - paid));
      rows.push({
        employeeId: emp.id,
        name: emp.name,
        code: emp.code,
        commissionPercent: emp.commissionPercent,
        salesTotal,
        commissionEarned,
        commissionPaid: paid,
        commissionRemaining: remaining,
        from: fromYmd,
        to: toYmd,
        userName: emp.user?.fullName || null,
      });
    }
    return { from: fromYmd, to: toYmd, rows };
  }

  listCommissionPayments(employeeId?: string) {
    return this.prisma.hrCommissionPayment.findMany({
      where: employeeId ? { employeeId } : {},
      include: {
        employee: { select: { id: true, code: true, name: true } },
        payrollRun: { select: { id: true, number: true } },
      },
      orderBy: { paidAt: 'desc' },
    });
  }

  /** ممنوع صرف العمولة منفصلاً */
  payCommissionAlone() {
    throw new BadRequestException('صرف العمولة فقط عبر ترحيل كشف المرتبات');
  }

  async employeeSalesReport(from?: string, to?: string) {
    const { fromDate, toDate, fromYmd, toYmd } = parseRange(
      from || cairoYmd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
      to || cairoYmd(new Date()),
    );
    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        invoiceDate: { gte: fromDate, lte: toDate },
        status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
        createdById: { not: null },
      },
      select: { createdById: true, total: true },
    });
    const byUser = new Map<string, number>();
    for (const inv of invoices) {
      if (!inv.createdById) continue;
      byUser.set(inv.createdById, (byUser.get(inv.createdById) || 0) + inv.total);
    }
    const employees = await this.prisma.hrEmployee.findMany({
      where: { userId: { not: null } },
      include: { user: { select: { id: true, fullName: true, username: true } } },
    });
    const empByUser = new Map(employees.map((e) => [e.userId!, e]));
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...byUser.keys()] } },
      select: { id: true, fullName: true, username: true },
    });
    const rows = users.map((u) => {
      const emp = empByUser.get(u.id);
      return {
        userId: u.id,
        name: emp?.name || u.fullName,
        code: emp?.code || u.username,
        employeeId: emp?.id || null,
        salesTotal: roundMoney(byUser.get(u.id) || 0),
        fromHr: !!emp,
      };
    });
    rows.sort((a, b) => b.salesTotal - a.salesTotal);
    return { from: fromYmd, to: toYmd, rows };
  }

  private async salesTotalFor(userId: string | null | undefined, fromDate: Date, toDate: Date) {
    if (!userId) return 0;
    const agg = await this.prisma.salesInvoice.aggregate({
      where: {
        createdById: userId,
        invoiceDate: { gte: fromDate, lte: toDate },
        status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
      },
      _sum: { total: true },
    });
    return roundMoney(agg._sum.total || 0);
  }

  /** مطابقة مدفوع العمولة بالفترة exact from/to */
  private async commissionPaidExact(employeeId: string, fromDate: Date, toDate: Date) {
    const payments = await this.prisma.hrCommissionPayment.findMany({
      where: { employeeId, fromDate, toDate },
      select: { amount: true },
    });
    return roundMoney(payments.reduce((s, p) => s + p.amount, 0));
  }

  // ─── payroll calc ─────────────────────────────────────────
  async calc(input: CalcLineInput) {
    const { fromDate, toDate, fromYmd, toYmd } = parseRange(input.from, input.to);
    const settings = await this.getSettings();
    const holidayRows = await this.prisma.hrHoliday.findMany({
      where: { date: { gte: fromDate, lte: toDate } },
    });
    const holidaySet = new Set(holidayRows.map((h) => cairoYmd(h.date)));
    const workdays = eachYmd(fromYmd, toYmd).filter(
      (d) => !isWeekend(d, settings.weekendDays) && !holidaySet.has(d),
    );

    const empWhere: Prisma.HrEmployeeWhereInput = { isActive: true };
    if (input.employeeId) empWhere.id = input.employeeId;
    if (input.employeeIds?.length) empWhere.id = { in: input.employeeIds };

    const employees = await this.prisma.hrEmployee.findMany({
      where: empWhere,
      orderBy: { code: 'asc' },
    });

    const lines = [];
    for (const emp of employees) {
      lines.push(await this.calcEmployeeLine(emp, fromDate, toDate, fromYmd, toYmd, workdays, settings));
    }
    const totalNet = roundMoney(lines.reduce((s, l) => s + l.net, 0));
    return {
      from: fromYmd,
      to: toYmd,
      settings,
      workdayCount: workdays.length,
      formula:
        'الصافي = (راتب الفترة − غياب×مضاعف − إجازة غير مدفوعة − تأخير بالساعة − إذن + إضافي×مضاعف + مكافآت − خصومات − سلف) + عمولة',
      lines,
      totalNet,
    };
  }

  private async calcEmployeeLine(
    emp: { id: string; code: string; name: string; salary: number; commissionPercent: number; userId: string | null },
    fromDate: Date,
    toDate: Date,
    fromYmd: string,
    toYmd: string,
    workdays: string[],
    settings: HrSettings,
  ) {
    const daily = roundMoney((emp.salary || 0) / settings.daysPerMonth);
    const hourlyRate = roundMoney(daily / Math.max(1, settings.hoursPerDay));
    const periodPay = roundMoney(daily * workdays.length);

    const [attendance, leaves, movements] = await Promise.all([
      this.prisma.hrAttendance.findMany({
        where: { employeeId: emp.id, workDate: { gte: fromDate, lte: toDate } },
      }),
      this.prisma.hrLeave.findMany({
        where: {
          employeeId: emp.id,
          status: HrLeaveStatus.APPROVED,
          fromDate: { lte: toDate },
          toDate: { gte: fromDate },
        },
      }),
      this.prisma.hrMovement.findMany({
        where: {
          employeeId: emp.id,
          payrollRunId: null,
          movementDate: { gte: fromDate, lte: toDate },
        },
      }),
    ]);

    const attByDay = new Map(attendance.map((a) => [cairoYmd(a.workDate), a]));
    const paidLeaveDaysSet = new Set<string>();
    const unpaidLeaveDaysSet = new Set<string>();
    for (const leave of leaves) {
      for (const d of eachYmd(cairoYmd(leave.fromDate), cairoYmd(leave.toDate))) {
        if (d < fromYmd || d > toYmd) continue;
        if (!workdays.includes(d)) continue;
        if (leave.kind === HrLeaveKind.PAID) paidLeaveDaysSet.add(d);
        else unpaidLeaveDaysSet.add(d);
      }
    }

    let presentDays = 0;
    let paidLeaveDays = 0;
    let permissionDays = 0;
    let absentDays = 0;
    let unpaidLeaveDays = 0;
    let totalLateMinutes = 0;
    let totalOvertimeMinutes = 0;
    let autoPermissionDeduct = 0;

    for (const d of workdays) {
      if (paidLeaveDaysSet.has(d)) {
        paidLeaveDays += 1;
        continue;
      }
      if (unpaidLeaveDaysSet.has(d)) {
        unpaidLeaveDays += 1;
        continue;
      }
      const att = attByDay.get(d);
      if (!att) {
        absentDays += 1;
        continue;
      }
      if (att.status === HrAttendanceStatus.ABSENT) {
        absentDays += 1;
        continue;
      }
      if (att.status === HrAttendanceStatus.PERMISSION) {
        permissionDays += 1;
        if (att.permissionMinutes > 0 && settings.permissionDeductPerHour > 0) {
          autoPermissionDeduct += (att.permissionMinutes / 60) * settings.permissionDeductPerHour;
        }
        continue;
      }
      if (att.status === HrAttendanceStatus.LEAVE) {
        paidLeaveDays += 1;
        continue;
      }
      if (att.status === HrAttendanceStatus.HOLIDAY) {
        continue;
      }
      presentDays += 1;
      const lateBillable = Math.max(0, (att.lateMinutes || 0) - settings.lateGraceMinutes);
      totalLateMinutes += lateBillable;
      totalOvertimeMinutes += Math.max(0, att.overtimeMinutes || 0);
      if (att.permissionMinutes > 0 && settings.permissionDeductPerHour > 0) {
        autoPermissionDeduct += (att.permissionMinutes / 60) * settings.permissionDeductPerHour;
      }
    }

    let bonuses = 0;
    let deductions = 0;
    let advances = 0;
    let latePenaltyExtra = 0;
    let permissionDeduct = autoPermissionDeduct;
    const movementIds: string[] = [];

    for (const m of movements) {
      movementIds.push(m.id);
      if (m.kind === HrMovementKind.BONUS) bonuses += m.amount;
      else if (m.kind === HrMovementKind.DEDUCTION) deductions += m.amount;
      else if (m.kind === HrMovementKind.ADVANCE) advances += m.amount;
      else if (m.kind === HrMovementKind.LATE) latePenaltyExtra += m.amount;
      else if (m.kind === HrMovementKind.PERMISSION) permissionDeduct += m.amount;
    }

    const lateHours = roundMoney(totalLateMinutes / 60);
    const overtimeHours = roundMoney(totalOvertimeMinutes / 60);
    const overtimePay = roundMoney(overtimeHours * hourlyRate * settings.overtimeMultiplier);
    const absenceDeduct = roundMoney(absentDays * daily * settings.absenceMultiplier);
    const unpaidLeaveDeductAmt = settings.unpaidLeaveDeduct
      ? roundMoney(unpaidLeaveDays * daily)
      : 0;

    let latePenalty = settings.lateByHourlyRate
      ? roundMoney(lateHours * hourlyRate)
      : roundMoney(totalLateMinutes * (settings.latePenaltyPerMinute || 0));
    latePenalty = roundMoney(latePenalty + latePenaltyExtra);

    bonuses = roundMoney(bonuses);
    deductions = roundMoney(deductions);
    advances = roundMoney(advances);
    permissionDeduct = roundMoney(permissionDeduct);

    const earned = roundMoney(periodPay - absenceDeduct - unpaidLeaveDeductAmt + overtimePay);
    const salaryNet = roundMoney(
      earned + bonuses - deductions - advances - latePenalty - permissionDeduct,
    );

    const salesTotal = await this.salesTotalFor(emp.userId, fromDate, toDate);
    const commissionRate = emp.commissionPercent || 0;
    const commissionEarned = roundMoney(salesTotal * (commissionRate / 100));
    const commissionPaidBefore = await this.commissionPaidExact(emp.id, fromDate, toDate);
    const commissionDue = roundMoney(Math.max(0, commissionEarned - commissionPaidBefore));
    const net = roundMoney(salaryNet + commissionDue);

    return {
      employeeId: emp.id,
      code: emp.code,
      name: emp.name,
      salary: emp.salary,
      presentDays,
      paidLeaveDays,
      permissionDays,
      absentDays,
      unpaidLeaveDays,
      daily,
      hourlyRate,
      overtimeHours,
      overtimePay,
      lateHours,
      earned,
      bonuses,
      deductions,
      advances,
      latePenalty,
      permissionDeduct,
      salaryNet,
      salesTotal,
      commissionRate,
      commissionEarned,
      commissionPaidBefore,
      commissionDue,
      net,
      movementIds,
      settingsSnapshot: {
        overtimeMultiplier: settings.overtimeMultiplier,
        absenceMultiplier: settings.absenceMultiplier,
        unpaidLeaveDeduct: settings.unpaidLeaveDeduct,
        hoursPerDay: settings.hoursPerDay,
      },
    };
  }

  // ─── payroll runs ─────────────────────────────────────────
  listRuns() {
    return this.prisma.hrPayrollRun.findMany({
      include: {
        lines: {
          include: { employee: { select: { id: true, code: true, name: true } } },
          orderBy: { employee: { code: 'asc' } },
        },
        _count: { select: { lines: true, commissionPayments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRun(id: string) {
    const run = await this.prisma.hrPayrollRun.findUnique({
      where: { id },
      include: {
        lines: {
          include: { employee: { select: { id: true, code: true, name: true } } },
          orderBy: { employee: { code: 'asc' } },
        },
        commissionPayments: true,
      },
    });
    if (!run) throw new NotFoundException('كشف المرتبات غير موجود');
    return run;
  }

  async saveRun(data: {
    from: string;
    to: string;
    methodId?: string;
    notes?: string;
    employeeIds?: string[];
    createdById?: string;
  }) {
    const calc = await this.calc({
      from: data.from,
      to: data.to,
      employeeIds: data.employeeIds,
    });
    if (!calc.lines.length) throw new BadRequestException('لا يوجد موظفون للحساب');

    const { fromDate, toDate } = parseRange(data.from, data.to);

    return this.prisma.$transaction(async (tx) => {
      const number = await nextSeq(tx, 'hr-payroll', 'PAY');
      const run = await tx.hrPayrollRun.create({
        data: {
          number,
          fromDate,
          toDate,
          status: HrPayrollStatus.DRAFT,
          methodId: data.methodId || null,
          notes: data.notes?.trim() || null,
          createdById: data.createdById || null,
          totalNet: calc.totalNet,
          lines: {
            create: calc.lines.map((l) => ({
              employeeId: l.employeeId,
              presentDays: l.presentDays,
              paidLeaveDays: l.paidLeaveDays,
              permissionDays: l.permissionDays,
              absentDays: l.absentDays,
              daily: l.daily,
              hourlyRate: l.hourlyRate,
              overtimeHours: l.overtimeHours,
              overtimePay: l.overtimePay,
              lateHours: l.lateHours,
              earned: l.earned,
              bonuses: l.bonuses,
              deductions: l.deductions,
              advances: l.advances,
              latePenalty: l.latePenalty,
              permissionDeduct: l.permissionDeduct,
              salaryNet: l.salaryNet,
              salesTotal: l.salesTotal,
              commissionRate: l.commissionRate,
              commissionEarned: l.commissionEarned,
              commissionPaidBefore: l.commissionPaidBefore,
              commissionDue: l.commissionDue,
              net: l.net,
            })),
          },
        },
        include: {
          lines: {
            include: { employee: { select: { id: true, code: true, name: true } } },
            orderBy: { employee: { code: 'asc' } },
          },
        },
      });

      const allMovementIds = calc.lines.flatMap((l) => l.movementIds);
      if (allMovementIds.length) {
        await tx.hrMovement.updateMany({
          where: { id: { in: allMovementIds }, payrollRunId: null },
          data: { payrollRunId: run.id },
        });
      }
      return run;
    });
  }

  async deleteRun(id: string) {
    const run = await this.getRun(id);
    if (run.status !== HrPayrollStatus.DRAFT) {
      throw new BadRequestException('فقط المسودة قابلة للحذف');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.hrMovement.updateMany({
        where: { payrollRunId: id },
        data: { payrollRunId: null, settledAt: null },
      });
      await tx.hrPayrollLine.deleteMany({ where: { runId: id } });
      await tx.hrPayrollRun.delete({ where: { id } });
    });
    return { ok: true };
  }

  async postRun(id: string, data?: { methodId?: string }) {
    const run = await this.getRun(id);
    if (run.status === HrPayrollStatus.POSTED) {
      throw new BadRequestException('الكشف مرحّل مسبقاً');
    }
    if (run.totalNet <= 0) {
      throw new BadRequestException('لا يمكن ترحيل كشف بصافي ≤ صفر');
    }
    await assertPeriodsOpen(this.prisma, run.fromDate, run.toDate, new Date());

    const methodId = data?.methodId || run.methodId;
    if (!methodId) throw new BadRequestException('اختر طريقة دفع فورية مربوطة بخزنة');
    const method = await this.prisma.payMethod.findUnique({ where: { id: methodId } });
    if (!method || method.kind !== PayMethodKind.IMMEDIATE || !method.cashAccountId) {
      throw new BadRequestException('طريقة الدفع لازم تكون فورية ومربوطة بخزنة');
    }
    const account = await this.prisma.cashAccount.findUnique({ where: { id: method.cashAccountId } });
    if (!account) throw new NotFoundException('حساب الخزنة غير موجود');

    let category = await this.prisma.expenseCategory.findUnique({ where: { name: SALARY_EXPENSE_CATEGORY } });
    if (!category) {
      category = await this.prisma.expenseCategory.create({ data: { name: SALARY_EXPENSE_CATEGORY } });
    }

    const totalNet = roundMoney(run.totalNet);

    return this.prisma.$transaction(async (tx) => {
      await tx.cashAccount.update({
        where: { id: account.id },
        data: { balance: { decrement: totalNet } },
      });
      await tx.cashTransaction.create({
        data: {
          accountId: account.id,
          direction: 'OUT',
          amount: totalNet,
          description: `صرف مرتبات ${run.number}`,
          paymentMethod: method.id,
          reference: run.number,
        },
      });
      const expense = await tx.expense.create({
        data: {
          categoryId: category!.id,
          accountId: account.id,
          amount: totalNet,
          expenseDate: new Date(),
          paymentMethod: method.id,
          notes: `كشف مرتبات ${run.number}`,
        },
      });

      await tx.hrMovement.updateMany({
        where: { payrollRunId: run.id },
        data: { settledAt: new Date() },
      });

      for (const line of run.lines) {
        if (line.commissionDue <= 0.009) continue;
        const comNumber = await nextSeq(tx, 'hr-commission', 'COM');
        await tx.hrCommissionPayment.create({
          data: {
            number: comNumber,
            employeeId: line.employeeId,
            fromDate: run.fromDate,
            toDate: run.toDate,
            amount: line.commissionDue,
            expenseId: expense.id,
            accountId: account.id,
            payrollRunId: run.id,
            notes: `ضمن صرف كشف المرتبات ${run.number}`,
          },
        });
      }

      return tx.hrPayrollRun.update({
        where: { id: run.id },
        data: {
          status: HrPayrollStatus.POSTED,
          methodId: method.id,
          accountId: account.id,
          expenseId: expense.id,
          postedAt: new Date(),
          totalNet,
        },
        include: {
          lines: {
            include: { employee: { select: { id: true, code: true, name: true } } },
            orderBy: { employee: { code: 'asc' } },
          },
          commissionPayments: true,
        },
      });
    });
  }

  async commissionsExcel(from?: string, to?: string) {
    const report = await this.commissionsReport(from, to);
    const ExcelJS = await import('exceljs');
    const { applyArabicSheet, stampApiBrandLogo } = await import('../common/excel-ar');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('عمولات');
    ws.columns = [
      { header: 'الكود', key: 'code', width: 12 },
      { header: 'الاسم', key: 'name', width: 24 },
      { header: 'نسبة %', key: 'commissionPercent', width: 10 },
      { header: 'المبيعات', key: 'salesTotal', width: 14 },
      { header: 'مستحق', key: 'commissionEarned', width: 14 },
      { header: 'مدفوع', key: 'commissionPaid', width: 14 },
      { header: 'متبقي', key: 'commissionRemaining', width: 14 },
    ];
    for (const row of report.rows) {
      ws.addRow({
        code: row.code,
        name: row.name,
        commissionPercent: row.commissionPercent,
        salesTotal: row.salesTotal,
        commissionEarned: row.commissionEarned,
        commissionPaid: row.commissionPaid,
        commissionRemaining: row.commissionRemaining,
      });
    }
    await stampApiBrandLogo(wb, ws);
    applyArabicSheet(ws);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
