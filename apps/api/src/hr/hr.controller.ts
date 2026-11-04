import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { HrAttendanceStatus, HrLeaveKind, HrMovementKind, Role } from '@prisma/client';
import { Response } from 'express';
import { Roles } from '../common/guards';
import { HrService } from './hr.service';
import type { HrSettings } from './hr.util';

class EmployeeDto {
  @IsOptional() @IsString() code?: string;
  @IsString() name!: string;
  @IsOptional() @IsString() userId?: string | null;
  @IsOptional() @IsNumber() salary?: number;
  @IsOptional() @IsNumber() commissionPercent?: number;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() hireDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class LeaveDto {
  @IsString() employeeId!: string;
  @IsString() fromDate!: string;
  @IsString() toDate!: string;
  @IsOptional() @IsEnum(HrLeaveKind) kind?: HrLeaveKind;
  @IsOptional() @IsString() notes?: string;
}

class MovementDto {
  @IsString() employeeId!: string;
  @IsEnum(HrMovementKind) kind!: HrMovementKind;
  @IsNumber() amount!: number;
  @IsOptional() @IsString() movementDate?: string;
  @IsOptional() @IsString() notes?: string;
}

class AttendanceDto {
  @IsString() employeeId!: string;
  @IsString() workDate!: string;
  @IsOptional() @IsEnum(HrAttendanceStatus) status?: HrAttendanceStatus;
  @IsOptional() @IsString() punchIn?: string | null;
  @IsOptional() @IsString() punchOut?: string | null;
  @IsOptional() @IsNumber() lateMinutes?: number;
  @IsOptional() @IsNumber() permissionMinutes?: number;
  @IsOptional() @IsNumber() overtimeMinutes?: number;
  @IsOptional() @IsString() notes?: string;
}

class PunchDto {
  @IsString() employeeId!: string;
  @IsOptional() @IsString() at?: string;
}

class HolidayDto {
  @IsString() date!: string;
  @IsString() name!: string;
}

class CalcDto {
  @IsString() from!: string;
  @IsString() to!: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) employeeIds?: string[];
}

class SaveRunDto {
  @IsString() from!: string;
  @IsString() to!: string;
  @IsOptional() @IsString() methodId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) employeeIds?: string[];
}

class PostRunDto {
  @IsOptional() @IsString() methodId?: string;
}

@Controller('hr')
@Roles(Role.ADMIN, Role.ACCOUNTANT)
export class HrController {
  constructor(private service: HrService) {}

  @Get('settings')
  getSettings() {
    return this.service.getSettings();
  }

  @Patch('settings')
  patchSettings(@Body() body: Partial<HrSettings>) {
    return this.service.patchSettings(body);
  }

  @Get('holidays')
  listHolidays() {
    return this.service.listHolidays();
  }

  @Post('holidays')
  createHoliday(@Body() dto: HolidayDto) {
    return this.service.createHoliday(dto);
  }

  @Delete('holidays/:id')
  deleteHoliday(@Param('id') id: string) {
    return this.service.deleteHoliday(id);
  }

  @Get('employees')
  listEmployees(@Query('q') q?: string) {
    return this.service.listEmployees(q);
  }

  @Get('employees/:id')
  getEmployee(@Param('id') id: string) {
    return this.service.getEmployee(id);
  }

  @Post('employees')
  createEmployee(@Body() dto: EmployeeDto) {
    return this.service.createEmployee(dto);
  }

  @Patch('employees/:id')
  updateEmployee(@Param('id') id: string, @Body() dto: Partial<EmployeeDto>) {
    return this.service.updateEmployee(id, dto);
  }

  @Delete('employees/:id')
  deleteEmployee(@Param('id') id: string) {
    return this.service.deleteEmployee(id);
  }

  @Get('linkable-users')
  linkableUsers() {
    return this.service.linkableUsers();
  }

  @Get('leaves')
  listLeaves(@Query('employeeId') employeeId?: string) {
    return this.service.listLeaves(employeeId);
  }

  @Post('leaves')
  createLeave(@Body() dto: LeaveDto) {
    return this.service.createLeave(dto);
  }

  @Delete('leaves/:id')
  deleteLeave(@Param('id') id: string) {
    return this.service.deleteLeave(id);
  }

  @Get('movements')
  listMovements(
    @Query('employeeId') employeeId?: string,
    @Query('unsettled') unsettled?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listMovements({ employeeId, unsettled, from, to });
  }

  @Post('movements')
  createMovement(@Body() dto: MovementDto) {
    return this.service.createMovement(dto);
  }

  @Delete('movements/:id')
  deleteMovement(@Param('id') id: string) {
    return this.service.deleteMovement(id);
  }

  @Get('attendance')
  listAttendance(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.service.listAttendance({ from, to, employeeId });
  }

  @Post('attendance')
  upsertAttendance(@Body() dto: AttendanceDto) {
    return this.service.upsertAttendance(dto);
  }

  @Delete('attendance/:id')
  deleteAttendance(@Param('id') id: string) {
    return this.service.deleteAttendance(id);
  }

  @Post('attendance/punch-in')
  punchIn(@Body() dto: PunchDto) {
    return this.service.punchIn(dto.employeeId, dto.at);
  }

  @Post('attendance/punch-out')
  punchOut(@Body() dto: PunchDto) {
    return this.service.punchOut(dto.employeeId, dto.at);
  }

  @Post('payroll/calc')
  calc(@Body() dto: CalcDto) {
    return this.service.calc(dto);
  }

  @Get('payroll/runs')
  listRuns() {
    return this.service.listRuns();
  }

  @Get('payroll/runs/:id')
  getRun(@Param('id') id: string) {
    return this.service.getRun(id);
  }

  @Post('payroll/runs')
  saveRun(@Body() dto: SaveRunDto, @Req() req: { user: { userId: string } }) {
    return this.service.saveRun({ ...dto, createdById: req.user.userId });
  }

  @Delete('payroll/runs/:id')
  deleteRun(@Param('id') id: string) {
    return this.service.deleteRun(id);
  }

  @Post('payroll/runs/:id/post')
  postRun(@Param('id') id: string, @Body() dto: PostRunDto) {
    return this.service.postRun(id, dto);
  }

  @Get('commissions')
  commissions(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.commissionsReport(from, to);
  }

  @Get('commissions/payments')
  commissionPayments(@Query('employeeId') employeeId?: string) {
    return this.service.listCommissionPayments(employeeId);
  }

  @Get('commissions/excel')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async commissionsExcel(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const buffer = await this.service.commissionsExcel(from, to);
    res.setHeader('Content-Disposition', 'attachment; filename=commissions.xlsx');
    res.send(buffer);
  }

  @Post('commissions/pay')
  payCommission() {
    return this.service.payCommissionAlone();
  }

  @Get('employee-sales')
  employeeSales(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.employeeSalesReport(from, to);
  }
}
