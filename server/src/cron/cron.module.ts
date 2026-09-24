import { Module } from '@nestjs/common';
import { GoodsModule } from '../goods/goods.module.js';
import { SiteModule } from '../site/site.module.js';
import { CronController } from './cron.controller.js';
import { CronJobsService } from './cron-jobs.service.js';
import { CronLockService } from './cron-lock.service.js';
import { CronScheduler } from './cron.scheduler.js';

@Module({
  imports: [GoodsModule, SiteModule],
  controllers: [CronController],
  providers: [CronLockService, CronJobsService, CronScheduler],
})
export class CronModule {}
