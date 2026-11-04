import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { Role, TaskPriority, TaskStatus } from '@prisma/client';
import { Response } from 'express';
import { Roles } from '../common/guards';
import { WorkService } from './work.service';

type AuthReq = { user: { userId: string; username: string; role: string } };
type Upload = { originalname: string; size: number; buffer: Buffer };

class SaveReportDto {
  @IsString() name!: string;
  @IsString() definition!: string;
}

class RunDto {
  @IsString() definition!: string;
}

class ExportDto {
  @IsIn(['csv', 'xlsx']) format!: 'csv' | 'xlsx';
  @IsString() definition!: string;
}

class RuleDto {
  @IsString() name!: string;
  @IsString() trigger!: string;
  @IsString() action!: string;
}

class RulePatchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class TaskDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() priority?: TaskPriority;
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsString() entityId?: string;
}

class MoveDto {
  @IsString() status!: TaskStatus;
}

class CommentDto {
  @IsString() body!: string;
}

class ViewDto {
  @IsString() module!: string;
  @IsString() name!: string;
  @IsString() query!: string;
}

class AttachMetaDto {
  @IsString() entityType!: string;
  @IsString() entityId!: string;
}

@Controller('work')
export class WorkController {
  constructor(private work: WorkService) {}

  @Get('catalog')
  catalog() {
    return this.work.catalog();
  }

  @Post('reports/run')
  run(@Body() dto: RunDto) {
    return this.work.runReport(this.parseDefinition(dto.definition));
  }

  @Post('reports/export')
  @HttpCode(200)
  async export(@Body() dto: ExportDto, @Res({ passthrough: true }) res: Response) {
    const file = await this.work.exportReport(this.parseDefinition(dto.definition), dto.format);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return new StreamableFile(file.body);
  }

  @Get('reports')
  reports(@Req() req: AuthReq) {
    return this.work.listReports(req.user);
  }

  @Post('reports')
  save(@Req() req: AuthReq, @Body() dto: SaveReportDto) {
    return this.work.saveReport(req.user, dto.name, this.parseDefinition(dto.definition));
  }

  @Post('reports/:id/run')
  async runSaved(@Req() req: AuthReq, @Param('id') id: string) {
    const { definition } = await this.work.savedDefinition(id, req.user);
    return this.work.runReport(definition);
  }

  @Post('reports/:id/duplicate')
  duplicate(@Req() req: AuthReq, @Param('id') id: string) {
    return this.work.duplicateReport(id, req.user);
  }

  @Delete('reports/:id')
  removeReport(@Req() req: AuthReq, @Param('id') id: string) {
    return this.work.removeReport(id, req.user);
  }

  @Get('intelligence')
  intelligence() {
    return this.work.intelligence();
  }

  @Get('drill')
  drill(@Query('metric') metric = 'sales', @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.work.drill(metric, preset, from, to);
  }

  @Get('automation')
  rules() {
    return this.work.listRules();
  }

  @Get('automation/runs')
  runs() {
    return this.work.recentRuns();
  }

  @Post('automation')
  @Roles(Role.ADMIN)
  createRule(@Body() dto: RuleDto) {
    return this.work.createRule(dto.name, dto.trigger, dto.action);
  }

  @Patch('automation/:id')
  @Roles(Role.ADMIN)
  updateRule(@Param('id') id: string, @Body() dto: RulePatchDto) {
    return this.work.updateRule(id, dto);
  }

  @Delete('automation/:id')
  @Roles(Role.ADMIN)
  removeRule(@Param('id') id: string) {
    return this.work.removeRule(id);
  }

  @Post('automation/run')
  @Roles(Role.ADMIN, Role.ACCOUNTANT, Role.WAREHOUSE)
  runRules(@Req() req: AuthReq) {
    return this.work.runAutomation(req.user);
  }

  @Get('tasks')
  tasks(@Query('status') status?: string) {
    return this.work.listTasks(status);
  }

  @Get('people')
  people() {
    return this.work.people();
  }

  @Post('tasks')
  createTask(@Req() req: AuthReq, @Body() dto: TaskDto) {
    return this.work.createTask(req.user, dto);
  }

  @Patch('tasks/:id')
  move(@Param('id') id: string, @Body() dto: MoveDto) {
    if (!Object.values(TaskStatus).includes(dto.status)) throw new BadRequestException('حالة غير معروفة');
    return this.work.moveTask(id, dto.status);
  }

  @Get('tasks/:id/comments')
  taskComments(@Param('id') id: string) {
    return this.work.comments(id);
  }

  @Post('tasks/:id/comments')
  comment(@Req() req: AuthReq, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.work.commentTask(req.user, id, dto.body);
  }

  @Delete('tasks/:id')
  @Roles(Role.ADMIN)
  removeTask(@Param('id') id: string) {
    return this.work.removeTask(id);
  }

  @Get('views')
  views(@Req() req: AuthReq, @Query('module') module = 'customers') {
    return this.work.listViews(req.user, module);
  }

  @Post('views')
  saveView(@Req() req: AuthReq, @Body() dto: ViewDto) {
    return this.work.saveView(req.user, dto.module, dto.name, dto.query);
  }

  @Delete('views/:id')
  removeView(@Req() req: AuthReq, @Param('id') id: string) {
    return this.work.removeView(req.user, id);
  }

  @Get('attachments')
  attachments(@Query('entityType') entityType: string, @Query('entityId') entityId: string) {
    return this.work.listAttachments(entityType, entityId);
  }

  @Post('attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  upload(@Req() req: AuthReq, @UploadedFile() file: Upload, @Body() dto: AttachMetaDto) {
    return this.work.addAttachment(req.user, dto.entityType, dto.entityId, file);
  }

  @Get('attachments/:id/file')
  async download(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.work.openAttachment(id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    return new StreamableFile(file.stream);
  }

  @Delete('attachments/:id')
  removeFile(@Req() req: AuthReq, @Param('id') id: string) {
    return this.work.removeAttachment(req.user, id);
  }

  @Get('360')
  view360(@Query('entityType') entityType: string, @Query('entityId') entityId: string) {
    return this.work.entity360(entityType, entityId);
  }

  private parseDefinition(raw: string) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('bad');
      return parsed;
    } catch {
      throw new BadRequestException('تعريف التقرير غير صالح');
    }
  }
}
