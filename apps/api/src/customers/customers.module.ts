import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { SequenceService } from '../common/sequence.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, SequenceService],
  exports: [CustomersService],
})
export class CustomersModule {}
