import { Injectable, Logger } from '@nestjs/common';
import { errorMessage } from '../common/format.js';
import { GoodsService } from '../goods/goods.service.js';
import { JuheExchangeService } from '../site/juhe-exchange.service.js';
import { CronLockService } from './cron-lock.service.js';

export const CRON_JOB_PRICE_SYNC = 'goods-price-sync';
export const CRON_JOB_EXCHANGE_RATES = 'exchange-rates-sync';

/** Price sync may scrape many URLs @ 120s each */
const PRICE_SYNC_LEASE_SECONDS = 30 * 60;
const EXCHANGE_LEASE_SECONDS = 10 * 60;

@Injectable()
export class CronJobsService {
  private readonly logger = new Logger(CronJobsService.name);

  constructor(
    private readonly lock: CronLockService,
    private readonly goodsService: GoodsService,
    private readonly juheExchangeService: JuheExchangeService,
  ) {}

  async runPriceSync() {
    const handle = await this.lock.tryAcquire(
      CRON_JOB_PRICE_SYNC,
      PRICE_SYNC_LEASE_SECONDS,
    );
    if (!handle) {
      return { skipped: true as const, reason: 'locked' as const };
    }
    this.logger.log('price sync starting');
    try {
      const summary = await this.goodsService.autoSyncEmptyPrices();
      this.logger.log(
        `price sync done orders=${summary.orders} tried=${summary.itemsTried} ok=${summary.itemsOk} fail=${summary.itemsFail}`,
      );
      return { skipped: false as const, ...summary };
    } catch (err) {
      this.logger.error(`price sync failed: ${errorMessage(err)}`);
      throw err;
    } finally {
      await this.lock.release(handle);
    }
  }

  async runExchangeRatesSync() {
    const handle = await this.lock.tryAcquire(
      CRON_JOB_EXCHANGE_RATES,
      EXCHANGE_LEASE_SECONDS,
    );
    if (!handle) {
      return { skipped: true as const, reason: 'locked' as const };
    }
    this.logger.log('exchange-rate sync starting');
    try {
      const result = await this.juheExchangeService.syncFromJuhe();
      this.logger.log(
        `exchange-rate sync done, updated=${result.updated.length}`,
      );
      return {
        skipped: false as const,
        updated: result.updated.length,
      };
    } catch (err) {
      this.logger.error(`exchange-rate sync failed: ${errorMessage(err)}`);
      throw err;
    } finally {
      await this.lock.release(handle);
    }
  }
}
