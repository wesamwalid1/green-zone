import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role, WarehouseKind } from '@prisma/client';
import { WarehousesService } from './warehouses.service';
import { Roles } from '../common/guards';

class WarehouseDto {
  @IsOptional() @IsString() code?: string;
  @IsString() name!: string;
  @IsOptional() @IsEnum(WarehouseKind) kind?: WarehouseKind;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() description?: string;
}

class UpdateWarehouseDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(WarehouseKind) kind?: WarehouseKind;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('warehouses')
export class WarehousesController {
  constructor(private service: WarehousesService) {}

  @Get()
  findAll(@Req() req: { user: { userId: string; role: string } }) {
    return this.service.findAll(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.WAREHOUSE)
  create(@Body() dto: WarehouseDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.WAREHOUSE)
  update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
