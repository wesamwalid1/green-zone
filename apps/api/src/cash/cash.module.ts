import { Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';
import { PayMethodsService } from './pay-methods.service';
import { SequenceService } from '../common/sequence.service';

@Module({
  controllers: [CashController],
  providers: [CashService, PayMethodsService, SequenceService],
  exports: [CashService, PayMethodsService],
})
export class CashModule {}
