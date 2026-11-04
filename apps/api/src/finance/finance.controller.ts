import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { CheckDirection, CheckStatus, Role } from '@prisma/client';
import { Roles } from '../common/guards';
import { FinanceService } from './finance.service';

class OpenShiftDto {
  @IsString() cashAccountId!: string;
  @IsNumber() openingCash!: number;
  @IsOptional() @IsString() notes?: string;
}

class CloseShiftDto {
  @IsNumber() closingCash!: number;
  @IsOptional() @IsString() notes?: string;
}

class ExpenseDto {
  @IsString() categoryId!: string;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() methodId?: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsString() expenseDate?: string;
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() shiftId?: string;
}

class CheckDto {
  @IsEnum(CheckDirection) direction!: CheckDirection;
  @IsString() checkNumber!: string;
  @IsString() bankName!: string;
  @IsNumber() amount!: number;
  @IsString() dueDate!: string;
  @IsOptional() @IsString() issueDate?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() notes?: string;
}

@Controller('finance')
export class FinanceController {
  constructor(private service: FinanceService) {}

  @Get('shifts')
  shifts() {
    return this.service.listShifts();
  }

  @Get('shifts/current')
  current(@Req() req: { user: { userId: string } }) {
    return this.service.currentShift(req.user.userId);
  }

  @Post('shifts')
  @Roles(Role.ADMIN, Role.SALES, Role.ACCOUNTANT)
  open(@Body() dto: OpenShiftDto, @Req() req: { user: { userId: string } }) {
    return this.service.openShift({ ...dto, userId: req.user.userId });
  }

  @Post('shifts/:id/close')
  @Roles(Role.ADMIN, Role.SALES, Role.ACCOUNTANT)
  close(@Param('id') id: string, @Body() dto: CloseShiftDto) {
    return this.service.closeShift(id, dto);
  }

  @Get('expense-categories')
  expenseCategories() {
    return this.service.listExpenseCategories();
  }

  @Post('expense-categories')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  createCategory(@Body() body: { name: string }) {
    return this.service.createExpenseCategory(body.name);
  }

  @Get('expenses')
  expenses(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.service.listExpenses({ page, pageSize });
  }

  @Post('expenses')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  createExpense(@Body() dto: ExpenseDto) {
    return this.service.createExpense(dto);
  }

  @Get('checks')
  checks(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string, @Query('direction') direction?: string) {
    return this.service.listChecks({ page, pageSize, status, direction });
  }

  @Post('checks')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  createCheck(@Body() dto: CheckDto) {
    return this.service.createCheck(dto);
  }

  @Patch('checks/:id')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  setCheck(@Param('id') id: string, @Body() body: { status: CheckStatus; accountId?: string; methodId?: string }) {
    return this.service.setCheckStatus(id, body.status, body.methodId || body.accountId);
  }
}
