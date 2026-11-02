import 'reflect-metadata';
import { type INestApplication, Logger, StandardSchemaSerializerInterceptor } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorCode, type ErrorBody } from '@frontdesk/shared';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { RedisIoAdapter } from './chat/redis-io.adapter.js';
import { ErrorFilter } from './common/errors.js';
import { makeLogger } from './common/logger.js';
import { requestIdMiddleware } from './common/request-context.js';
import { validationPipe } from './common/schema.js';
import type { AppConfig } from './config.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Routes the widget calls from customers' websites: no cookies, any origin (checked per workspace). */
const WIDGET_PREFIX = '/api/widget/';

const requestOrigin = (req: Request): string | undefined => {
  const origin = req.get('origin');
  if (origin) return origin;
  try {
    return new URL(req.get('referer') ?? '').origin;
  } catch {
    return undefined;
  }
};

/** Shared by src/main.ts and the tests, so both run exactly the same middleware. */
export const createApp = async (config: AppConfig): Promise<INestApplication> => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forConfig(config), {
    logger: makeLogger(config.NODE_ENV),
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '100kb' });
  app.set('trust proxy', 'loopback'); // a reverse proxy on the same host sets X-Forwarded-For
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);

  // The dashboard calls the API through the Next.js /api rewrite (same origin). Widget routes allow any origin.
  app.enableCors((req: Request, cb: (err: Error | null, opts: object) => void) =>
    cb(null, req.path.startsWith(WIDGET_PREFIX) ? { origin: '*', credentials: false, maxAge: 600 } : { origin: false }),
  );

  const webOrigin = new URL(config.WEB_URL).origin;
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    // CSRF: cookie-authenticated writes must come from the dashboard's own origin.
    if (!SAFE_METHODS.has(req.method) && !req.path.startsWith(WIDGET_PREFIX) && requestOrigin(req) !== webOrigin) {
      res.status(403).json({
        statusCode: 403,
        errorCode: ErrorCode.BAD_ORIGIN,
        message: 'This request didn’t come from the Frontdesk dashboard.',
      } satisfies ErrorBody);
      return;
    }
    next();
  });

  if (config.NODE_ENV !== 'test') {
    const log = new Logger('Http');
    app.use((req: Request, res: Response, next: NextFunction) => {
      const started = Date.now();
      // Method, route pattern, status and time only: never bodies, query strings or tokens.
      res.on('finish', () => {
        if (req.path === '/api/health') return;
        const route = (req.route as { path?: string } | undefined)?.path ?? 'unmatched';
        log.log(`${req.method} ${route} ${res.statusCode} ${Date.now() - started}ms`);
      });
      next();
    });
  }

  app.setGlobalPrefix('api');
  app.useGlobalPipes(validationPipe);
  app.useGlobalInterceptors(new StandardSchemaSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new ErrorFilter());
  app.useWebSocketAdapter(new RedisIoAdapter(app, config));
  app.enableShutdownHooks();
  return app;
};
