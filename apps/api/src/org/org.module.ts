import { Module } from '@nestjs/common';
import { NotesController, OrgController } from './org.controller';
import { OrgService } from './org.service';

@Module({
  controllers: [OrgController, NotesController],
  providers: [OrgService],
})
export class OrgModule {}
