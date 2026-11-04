import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { createApp } from './app.factory';

async function bootstrap() {
  const app = await createApp();

  const webDist = process.env.WEB_DIST || resolve(process.cwd(), '../web/dist');
  const indexHtml = join(webDist, 'index.html');
  if (existsSync(indexHtml)) {
    app.useStaticAssets(webDist, { index: false });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(indexHtml);
    });
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`M5azen API running on http://localhost:${port}/api`);
  if (existsSync(indexHtml)) console.log(`M5azen web served from ${webDist}`);
}

bootstrap();
