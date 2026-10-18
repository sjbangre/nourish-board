import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
@Catch()
class ApiErrorFilter implements ExceptionFilter {
  catch(error: Error, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const databaseFailure =
      'code' in error &&
      /^(E[A-Z]+|ERR_SQLITE|SQLITE_)/.test(String(error.code));
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : databaseFailure
          ? 503
          : 400;
    const details =
      error instanceof HttpException
        ? error.getResponse()
        : {
            message: databaseFailure
              ? 'Database temporarily unavailable. Please retry shortly.'
              : error.message,
          };
    res
      .status(status)
      .json(typeof details === 'object' ? details : { message: details });
  }
}
export async function createApp() {
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CLIENT_SECRET ||
      !process.env.APP_URL?.startsWith('https://') ||
      process.env.LOCAL_DEV_AUTH === 'true')
  )
    throw new Error(
      'Production requires Google OAuth credentials, HTTPS APP_URL, and LOCAL_DEV_AUTH disabled.',
    );
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
  });
  app.setGlobalPrefix('api');
  app.use(helmet(), cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expected = process.env.APP_URL || 'http://localhost:4318';
      const allowed = new Set([
        expected,
        ...(!process.env.APP_URL && process.env.NODE_ENV !== 'production'
          ? ['http://127.0.0.1:4318']
          : []),
      ]);
      if (
        (req.headers.origin && !allowed.has(req.headers.origin)) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      )
        return res
          .status(403)
          .json({ message: 'Cross-origin request rejected.' });
      if (!String(req.headers['content-type']).startsWith('application/json'))
        return res.status(415).json({ message: 'JSON requests are required.' });
    }
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();
  return app;
}
if (require.main === module)
  createApp()
    .then((app) =>
      app.listen(
        Number(process.env.API_PORT || 4319),
        process.env.API_HOST || '127.0.0.1',
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
