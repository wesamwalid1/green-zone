import { Module } from '@nestjs/common';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { SequenceService } from '../common/sequence.service';

@Module({
  controllers: [ReturnsController],
  providers: [ReturnsService, SequenceService],
})
export class ReturnsModule {}
