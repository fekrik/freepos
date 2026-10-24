import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthController, AuthService } from './auth/auth.controller';
import { CatalogController } from './catalog/catalog.controller';
import { StoresController } from './stores/stores.controller';
import { SalesController } from './sales/sales.controller';
import { TimeClockController } from './timeclock/timeclock.controller';
import { HealthController } from './health.controller';

import { existsSync } from 'fs';
import { join } from 'path';
import { ServeStaticModule } from '@nestjs/serve-static';

if (typeof process.loadEnvFile === 'function') {
  for (const envFile of ['.env', '../../.env.local', '../.env.local', '.env.local']) {
    if (existsSync(envFile)) {
      try { process.loadEnvFile(envFile); } catch {}
      break;
    }
  }
}

const secret = process.env.JWT_SECRET;
if (!secret || (process.env.NODE_ENV === 'production' && secret === 'change-me-in-production')) {
  throw new Error('JWT_SECRET must be set (and not the default in production)');
}

const staticCandidates = [
  process.env.STATIC_ROOT,
  join(__dirname, '../../web/dist'),
  join(process.cwd(), '../web/dist'),
  join(process.cwd(), 'apps/web/dist'),
].filter(Boolean) as string[];

const staticRoot = staticCandidates.find((dir) => existsSync(dir));
if (staticRoot) {
  console.log(`[Static] Serving web frontend from ${staticRoot}`);
}

@Module({
  imports: [
    JwtModule.register({ global: true, secret }),
    ...(staticRoot
      ? [
          ServeStaticModule.forRoot({
            rootPath: staticRoot,
            exclude: ['/api/(.*)'],
          }),
        ]
      : []),
  ],
  controllers: [
    HealthController,
    AuthController,
    CatalogController,
    StoresController,
    SalesController,
    TimeClockController,
  ],
  providers: [PrismaService, AuditService, AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
