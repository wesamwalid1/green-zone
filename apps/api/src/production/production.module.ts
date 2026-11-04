import { Module } from '@nestjs/common';
import { SequenceService } from '../common/sequence.service';
import { SalesModule } from '../sales/sales.module';
import { MfgService } from './mfg.service';
import { ProdOrdersService } from './prod-orders.service';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { WorkOrdersService } from './work-orders.service';

@Module({
  imports: [SalesModule],
  controllers: [ProductionController],
  providers: [ProductionService, MfgService, ProdOrdersService, WorkOrdersService, SequenceService],
  exports: [ProductionService, MfgService, ProdOrdersService, WorkOrdersService],
})
export class ProductionModule {}
