import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DocKind, Role } from '@prisma/client';
import { Roles } from '../common/guards';
import { DocumentsService } from './documents.service';

class LineDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() quantity!: number;
  @IsNumber() unitPrice!: number;
  @IsOptional() @IsNumber() discount?: number;
}

class CreateDocDto {
  @IsEnum(DocKind) kind!: DocKind;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() docDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsNumber() discount?: number;
  @IsOptional() @IsNumber() taxRate?: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => LineDto)
  lines!: LineDto[];
}

@Controller('documents')
export class DocumentsController {
  constructor(private service: DocumentsService) {}

  @Get()
  list(@Query('kind') kind?: DocKind) {
    return this.service.list(kind);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SALES, Role.ACCOUNTANT, Role.WAREHOUSE)
  create(@Body() dto: CreateDocDto) {
    return this.service.create(dto);
  }

  @Post(':id/cancel')
  @Roles(Role.ADMIN, Role.SALES, Role.ACCOUNTANT)
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Post(':id/convert')
  @Roles(Role.ADMIN, Role.SALES, Role.ACCOUNTANT, Role.WAREHOUSE)
  convert(@Param('id') id: string, @Req() req: { user: { userId: string } }) {
    return this.service.convert(id, req.user.userId);
  }
}
