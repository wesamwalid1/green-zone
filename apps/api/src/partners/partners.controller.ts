import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { PartnersService } from './partners.service';
import { Roles } from '../common/guards';

class PartnerDto {
  @IsOptional() @IsString() code?: string;
  @IsString() name!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsNumber() sharePercent?: number;
  @IsOptional() @IsString() notes?: string;
}

class UpdatePartnerDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsNumber() sharePercent?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class WithdrawDto {
  @IsString() partnerId!: string;
  @IsString() methodId!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() withdrawnAt?: string;
}

@Controller('partners')
@Roles('ADMIN', 'ACCOUNTANT')
export class PartnersController {
  constructor(private service: PartnersService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('profit')
  profit(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.profitSummary(from, to);
  }

  @Get('withdrawals')
  withdrawals(@Query('partnerId') partnerId?: string) {
    return this.service.listWithdrawals(partnerId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() dto: PartnerDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePartnerDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('withdrawals')
  withdraw(@Body() dto: WithdrawDto) {
    return this.service.withdraw(dto);
  }
}
