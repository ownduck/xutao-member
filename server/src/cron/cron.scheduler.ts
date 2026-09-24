import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CronJobsService } from './cron-jobs.service.js';

const onVercel = process.env.VERCEL === '1';

@Injectable()
export class CronScheduler {
  private readonly logger = new Logger(CronScheduler.name);

  constructor(private readonly cronJobs: CronJobsService) {}

  /** Local/long-running only; Vercel uses HTTP cron instead */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    timeZone: 'Asia/Shanghai',
    disabled: onVercel,
  })
  async handlePriceSync() {
    const result = await this.cronJobs.runPriceSync();
    if (result.skipped) {
      this.logger.warn('price sync skipped (lock held)');
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM, {
    timeZone: 'Asia/Shanghai',
    disabled: onVercel,
  })
  async handleExchangeRates() {
    const result = await this.cronJobs.runExchangeRatesSync();
    if (result.skipped) {
      this.logger.warn('exchange-rate sync skipped (lock held)');
    }
  }
}
