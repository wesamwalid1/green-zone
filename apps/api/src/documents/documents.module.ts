import { Module } from '@nestjs/common';
import { SequenceService } from '../common/sequence.service';
import { PurchasesModule } from '../purchases/purchases.module';
import { SalesModule } from '../sales/sales.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [SalesModule, PurchasesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, SequenceService],
})
export class DocumentsModule {}
