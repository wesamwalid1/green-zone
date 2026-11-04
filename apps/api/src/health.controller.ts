import { Controller, Get } from '@nestjs/common';
import { Public } from './common/guards';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, time: new Date().toISOString() };
  }
}
