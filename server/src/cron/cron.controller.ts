import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { CronJobsService } from './cron-jobs.service.js';

/**
 * Vercel Cron hits these paths (GET) with:
 *   Authorization: Bearer ${CRON_SECRET}
 */
@Controller('api/cron')
export class CronController {
  constructor(private readonly cronJobs: CronJobsService) {}

  private assertCronAuth(authorization?: string) {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) {
      throw new UnauthorizedException('CRON_SECRET 未配置');
    }
    const expected = `Bearer ${secret}`;
    if (authorization !== expected) {
      throw new UnauthorizedException('Invalid cron secret');
    }
  }

  @Get('price-sync')
  @AllowAnonymous()
  async priceSync(@Headers('authorization') authorization?: string) {
    this.assertCronAuth(authorization);
    return this.cronJobs.runPriceSync();
  }

  @Get('exchange-rates')
  @AllowAnonymous()
  async exchangeRates(@Headers('authorization') authorization?: string) {
    this.assertCronAuth(authorization);
    return this.cronJobs.runExchangeRatesSync();
  }
}
