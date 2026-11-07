import { Body, Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { Public, Roles } from '../common/guards';
import { SyncService } from './sync.service';

class ConfigureDto {
  @IsOptional() @IsString() cloudUrl?: string;
  @IsOptional() @IsString() cloudToken?: string;
  @IsOptional() @IsString() label?: string;
}

class PushDto {
  @IsString() deviceKey!: string;
  changes!: {
    id?: string;
    entityType: string;
    entityId: string;
    op: 'UPSERT' | 'DELETE';
    payload: string;
    version: number;
    deviceKey: string;
    createdAt: string;
  }[];
}

function assertSyncKey(headerKey?: string) {
  const expected = (process.env.SYNC_API_KEY || '').trim();
  if (!expected) return; // بدون مفتاح: مسموح للتطوير المحلي
  const got = (headerKey || '').trim();
  if (got !== expected) throw new UnauthorizedException('مفتاح المزامنة غير صالح');
}

@Controller('sync')
export class SyncController {
  constructor(private sync: SyncService) {}

  @Get('status')
  @Roles(Role.ADMIN, Role.ACCOUNTANT, Role.SALES, Role.WAREHOUSE)
  status() {
    return this.sync.status();
  }

  @Post('configure')
  @Roles(Role.ADMIN)
  configure(@Body() dto: ConfigureDto) {
    return this.sync.configure(dto);
  }

  @Post('run')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  run() {
    return this.sync.runCycle();
  }

  @Post('bootstrap')
  @Roles(Role.ADMIN)
  bootstrap() {
    return this.sync.bootstrapFromCloud();
  }

  @Post('seed-outbox')
  @Roles(Role.ADMIN)
  seedOutbox() {
    return this.sync.seedOutbox();
  }

  /** السحابة تستقبل دفعات من الديسكتوب */
  @Post('push')
  @Public()
  push(@Body() dto: PushDto, @Headers('x-sync-key') syncKey?: string) {
    assertSyncKey(syncKey);
    return this.sync.acceptPush(dto);
  }

  @Get('pull')
  @Public()
  pull(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('excludeDevice') excludeDevice?: string,
    @Headers('x-sync-key') syncKey?: string,
  ) {
    assertSyncKey(syncKey);
    return this.sync.exportChanges(cursor, limit ? Number(limit) : 200, excludeDevice);
  }

  @Get('conflicts')
  @Roles(Role.ADMIN, Role.ACCOUNTANT)
  conflicts() {
    return this.sync.listConflicts();
  }

  @Post('conflicts/:id/resolve')
  @Roles(Role.ADMIN)
  resolve(@Param('id') id: string) {
    return this.sync.resolveConflict(id);
  }

  @Get('device')
  @Public()
  device() {
    return { deviceKey: this.sync.getDeviceKey(), phase: process.env.SYNC_PHASE || '1' };
  }
}
