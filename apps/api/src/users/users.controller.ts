import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { Roles } from '../common/guards';
import { SettingsGateGuard } from '../settings/settings-gate';

class CreateUserDto {
  @IsString() username!: string;
  @IsString() @MinLength(4) password!: string;
  @IsString() fullName!: string;
  @IsEnum(Role) role!: Role;
}

class ChangePasswordDto {
  @IsString() @MinLength(1) currentPassword!: string;
  @IsString() @MinLength(4) newPassword!: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MinLength(4) password?: string;
  @IsOptional() @IsObject() permissions?: Record<string, unknown>;
}

@Controller('users')
@Roles(Role.ADMIN)
@UseGuards(SettingsGateGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Post('me/password')
  @Roles()
  changePassword(
    @Req() req: { user: { userId: string } },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.users.changePassword(req.user.userId, dto.currentPassword, dto.newPassword);
  }

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: { user: { userId: string } }) {
    return this.users.update(id, dto, req.user.userId);
  }

  @Get('me/warehouses')
  myWarehouses(@Req() req: { user: { userId: string; role: Role } }) {
    if (req.user.role === Role.ADMIN) return [];
    return this.users.warehouses(req.user.userId);
  }

  @Get(':id/warehouses')
  warehouses(@Param('id') id: string) {
    return this.users.warehouses(id);
  }

  @Put(':id/warehouses')
  setWarehouses(@Param('id') id: string, @Body() body: { warehouseIds: string[] }) {
    return this.users.setWarehouses(id, body.warehouseIds || []);
  }
}
