import { Module } from '@nestjs/common';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { SequenceService } from '../common/sequence.service';

@Module({
  controllers: [PurchasesController],
  providers: [PurchasesService, SequenceService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
