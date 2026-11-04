import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../common/guards';
import { OpsService } from './ops.service';

class ReadDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];
}

@Controller('ops')
export class OpsController {
  constructor(private ops: OpsService) {}

  @Get('search')
  search(@Query('q') q = '') {
    return this.ops.search(q);
  }

  @Get('overview')
  overview(@Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.ops.overview(preset, from, to);
  }

  @Get('insights')
  insights() {
    return this.ops.insights();
  }

  @Get('notifications')
  notifications() {
    return this.ops.notifications();
  }

  @Post('notifications/read')
  read(@Body() dto: ReadDto) {
    return this.ops.markRead(dto.ids);
  }

  @Get('audit')
  @Roles(Role.ADMIN)
  audit(@Query('q') q?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string) {
    return this.ops.audit(q, { page, pageSize, status });
  }

  @Get('activity')
  activity(@Req() req: { user: { userId: string } }) {
    return this.ops.activity(req.user.userId);
  }
}
