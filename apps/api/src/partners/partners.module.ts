import { Module } from '@nestjs/common';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';
import { SequenceService } from '../common/sequence.service';

@Module({
  controllers: [PartnersController],
  providers: [PartnersService, SequenceService],
  exports: [PartnersService],
})
export class PartnersModule {}
