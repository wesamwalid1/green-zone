import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { Public } from '../common/guards';

function resolveInstallerPath(): string | null {
  const configured = (process.env.DESKTOP_DOWNLOAD_URL || '').trim();
  if (configured && !/^https?:\/\//i.test(configured) && existsSync(configured)) {
    return configured;
  }

  const cwd = process.cwd();
  const roots = [
    process.env.WEB_DIST || join(cwd, '../web/dist'),
    join(cwd, '../web/public'),
    join(cwd, '../desktop/release'),
    join(cwd, '../../apps/desktop/release'),
  ];

  const preferredNames = [
    'GreenZone-Setup.exe',
    'GreenZone-Setup-1.0.1.exe',
    'GreenZone-Setup-1.0.0.exe',
  ];

  for (const root of roots) {
    for (const name of preferredNames) {
      const full = join(root, name);
      if (existsSync(full)) return full;
      const nested = join(root, 'downloads', name);
      if (existsSync(nested)) return nested;
    }
    // أي Setup exe في مجلد release
    try {
      if (!existsSync(root)) continue;
      const hit = readdirSync(root).find(
        (name) => /^GreenZone-Setup.*\.exe$/i.test(name) || /^GreenZone.*Setup.*\.exe$/i.test(name),
      );
      if (hit) return join(root, hit);
    } catch {
      /* ignore */
    }
  }
  return null;
}

@Controller('desktop')
export class DesktopController {
  @Get('download')
  @Public()
  download(@Res() res: Response) {
    const configured = (process.env.DESKTOP_DOWNLOAD_URL || '').trim();
    if (configured && /^https?:\/\//i.test(configured)) {
      return res.redirect(302, configured);
    }

    const file = resolveInstallerPath();
    if (file) {
      return res.download(file, 'GreenZone-Setup.exe');
    }

    return res.status(404).json({
      available: false,
      message:
        'ملف تثبيت سطح المكتب غير متوفر حاليًا. ابني المثبّت بأمر npm run prepare:desktop ثم npm run dist -w @m5azen/desktop، أو اضبط DESKTOP_DOWNLOAD_URL.',
    });
  }

  @Get('info')
  @Public()
  info() {
    const configured = (process.env.DESKTOP_DOWNLOAD_URL || '').trim();
    const file = resolveInstallerPath();
    const available = !!(file || (configured && /^https?:\/\//i.test(configured)));
    return {
      available,
      platform: 'win32',
      downloadPath: '/api/desktop/download',
      configuredUrl: configured || null,
      hasLocalFile: !!file,
      label: 'تحميل نسخة سطح المكتب',
      hint: available
        ? 'للتثبيت على ويندوز والعمل بدون إنترنت ثم المزامنة عند رجوع الشبكة'
        : 'المثبّت لسه مش مرفوع — بعد البناء هيظهر زر التحميل مباشرة',
    };
  }
}
