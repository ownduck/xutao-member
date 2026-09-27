import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auth } from './auth/auth.js';
import { AppController } from './app.controller.js';
import { CronModule } from './cron/cron.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { GoodsModule } from './goods/goods.module.js';
import { RbacModule } from './rbac/rbac.module.js';
import { SiteModule } from './site/site.module.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const staticModules =
  process.env.NODE_ENV === 'production'
    ? [
        ServeStaticModule.forRoot({
          // Copied from web/dist by `npm run build` (scripts/copy-web-dist.mjs)
          rootPath: join(__dirname, '..', 'public'),
          exclude: ['/api*'],
        }),
      ]
    : [];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    AuthModule.forRoot({
      auth,
      disableTrustedOriginsCors: true,
    }),
    RbacModule,
    SiteModule,
    FinanceModule,
    GoodsModule,
    CronModule,
    ...staticModules,
  ],
  controllers: [AppController],
})
export class AppModule {}
