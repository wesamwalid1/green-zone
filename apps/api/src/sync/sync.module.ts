import { Module } from '@nestjs/common';
import { DesktopController } from './desktop.controller';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  controllers: [SyncController, DesktopController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
