import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { SequenceService } from '../common/sequence.service';

@Module({
  controllers: [StockController],
  providers: [StockService, SequenceService],
  exports: [StockService, SequenceService],
})
export class StockModule {}
