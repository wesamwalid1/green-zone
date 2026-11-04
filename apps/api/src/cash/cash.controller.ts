import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { CashDirection, PayMethodKind, Role } from '@prisma/client';
import { CashService } from './cash.service';
import { PayMethodsService } from './pay-methods.service';
import { Roles } from '../common/guards';

class AccountDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsNumber() balance?: number;
  @IsOptional() @IsString() accountType?: string;
}

class TxDto {
  @IsString() accountId!: string;
  @IsEnum(CashDirection) direction!: CashDirection;
  @IsNumber() amount!: number;
  @IsString() description!: string;
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() voucherKind?: 'RECEIPT' | 'PAYOUT' | 'MANUAL';
}

class ReceiptDto {
  @IsString() customerId!: string;
  @IsString() methodId!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsString() salesInvoiceId?: string;
  @IsOptional() @IsString() referenceNo?: string;
  @IsOptional() @IsString() note?: string;
}

class PaymentDto {
  @IsString() supplierId!: string;
  @IsString() methodId!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsString() purchaseInvoiceId?: string;
  @IsOptional() @IsString() referenceNo?: string;
  @IsOptional() @IsString() note?: string;
}

class MethodDto {
  @IsString() name!: string;
  @IsString() code!: string;
  @IsOptional() @IsEnum(PayMethodKind) kind?: PayMethodKind;
  @IsOptional() @IsString() accountType?: string;
  @IsOptional() @IsNumber() balance?: number;
}

@Controller('cash')
export class CashController {
  constructor(private service: CashService, private methods: PayMethodsService) {}

  @Get('methods')
  listMethods() {
    return this.methods.list();
  }

  @Post('methods')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  createMethod(@Body() dto: MethodDto) {
    return this.methods.create(dto);
  }

  @Get('accounts')
  accounts() {
    return this.service.accounts();
  }

  @Post('accounts')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  createAccount(@Body() dto: AccountDto) {
    return this.service.createAccount(dto);
  }

  @Patch('accounts/:id')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  updateAccount(@Param('id') id: string, @Body() dto: Partial<AccountDto & { isActive: boolean }>) {
    return this.service.updateAccount(id, dto);
  }

  @Get('transactions')
  transactions(
    @Query('accountId') accountId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
  ) {
    return this.service.transactions(accountId, { page, pageSize, q });
  }

  @Post('transactions')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  createTx(@Body() dto: TxDto, @Req() req: { user: { userId: string } }) {
    return this.service.createTransaction({ ...dto, createdById: req.user.userId });
  }

  @Get('suppliers/:id/summary')
  supplierSummary(@Param('id') id: string) {
    return this.service.supplierSummary(id);
  }

  @Get('customers/:id/summary')
  customerSummary(@Param('id') id: string) {
    return this.service.customerSummary(id);
  }

  @Get('receipts')
  receipts(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('q') q?: string) {
    return this.service.receipts({ page, pageSize, q });
  }

  @Post('receipts')
  @Roles(Role.ADMIN, Role.ACCOUNTANT, Role.SALES)
  createReceipt(@Body() dto: ReceiptDto) {
    return this.service.createReceipt(dto);
  }

  @Get('payments')
  payments(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('q') q?: string) {
    return this.service.payments({ page, pageSize, q });
  }

  @Post('payments')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  createPayment(@Body() dto: PaymentDto) {
    return this.service.createPayment(dto);
  }
}
