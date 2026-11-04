import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrgKind, Role } from '@prisma/client';
import { Roles } from '../common/guards';
import { OrgService } from './org.service';
import { PrismaService } from '../prisma/prisma.service';

class OrgDto {
  @IsEnum(OrgKind) kind!: OrgKind;
  @IsString() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() levelMark?: string;
  @IsOptional() @IsString() parentId?: string;
}

class OrgUpdateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() levelMark?: string;
  @IsOptional() @IsString() parentId?: string;
}

class AssignDto {
  @IsString() userId!: string;
  @IsOptional() @IsString() nodeId?: string;
}

class NoteDto {
  @IsString() entityType!: string;
  @IsString() entityId!: string;
  @IsString() body!: string;
}

@Controller('org')
export class OrgController {
  constructor(private org: OrgService) {}

  @Get()
  list(@Query('kind') kind?: OrgKind) {
    return this.org.list(kind);
  }

  @Get('members')
  @Roles(Role.ADMIN)
  members() {
    return this.org.members();
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: OrgDto) {
    return this.org.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: OrgUpdateDto) {
    return this.org.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.org.remove(id);
  }

  @Post('assign')
  @Roles(Role.ADMIN)
  assign(@Body() dto: AssignDto) {
    return this.org.assign(dto.userId, dto.nodeId || null);
  }
}

@Controller('notes')
export class NotesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@Query('entityType') entityType: string, @Query('entityId') entityId: string) {
    return this.prisma.recordNote.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Post()
  create(@Body() dto: NoteDto, @Req() req: { user: { userId: string; username: string } }) {
    return this.prisma.user.findUnique({ where: { id: req.user.userId }, select: { fullName: true } }).then((user) =>
      this.prisma.recordNote.create({
        data: {
          entityType: dto.entityType,
          entityId: dto.entityId,
          body: dto.body.trim(),
          userId: req.user.userId,
          userName: user?.fullName || req.user.username,
        },
      }),
    );
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.prisma.recordNote.delete({ where: { id } });
  }
}
