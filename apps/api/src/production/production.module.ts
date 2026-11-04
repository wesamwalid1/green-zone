import { Module } from '@nestjs/common';
import { SequenceService } from '../common/sequence.service';
import { MfgService } from './mfg.service';
import { ProdOrdersService } from './prod-orders.service';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

@Module({
  controllers: [ProductionController],
  providers: [ProductionService, MfgService, ProdOrdersService, SequenceService],
  exports: [ProductionService, MfgService, ProdOrdersService],
})
export class ProductionModule {}
