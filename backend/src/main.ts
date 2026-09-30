import './env';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '100kb' });
  app.use((req: Request & { id?: string }, res: Response, next: NextFunction) => {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  // CSRF defence-in-depth (docs/13-security.md §5): state-changing requests must
  // carry the custom header, which browsers cannot add cross-site without CORS.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'genzhire') {
      res.status(403).type('application/problem+json').json({ title: 'Missing request header', status: 403, code: 'CSRF_CHECK_FAILED' });
      return;
    }
    next();
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`GenZHire API on http://localhost:${port}/api/v1`);
}

bootstrap();
