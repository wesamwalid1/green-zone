import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private service: DashboardService) {}

  @Get()
  summary() {
    return this.service.summary();
  }

  @Get('insight')
  insight() {
    return this.service.insight();
  }
}
