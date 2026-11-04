import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { verifyEditToken } from './settings-gate';

@Injectable()
export class EditPasswordGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ method?: string; originalUrl?: string; url?: string; headers: Record<string, string | undefined> }>();
    const method = (req.method || '').toUpperCase();
    if (!['PATCH', 'PUT', 'DELETE'].includes(method)) return true;
    const url = req.originalUrl || req.url || '';
    if (url.includes('/settings') || url.includes('/auth')) return true;
    const row = await this.prisma.setting.findUnique({ where: { key: 'editPasswordHash' } });
    if (!row?.value) return true;
    if (!verifyEditToken(req.headers['x-edit-token'])) {
      throw new ForbiddenException('أدخل كلمة سر التعديل');
    }
    return true;
  }
}
