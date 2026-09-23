import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { errorMessage } from '../common/format.js';
import { GoodsService } from './goods.service.js';

@Injectable()
export class GoodsPriceSyncCron {
  private readonly logger = new Logger(GoodsPriceSyncCron.name);
  private running = false;

  constructor(private readonly goodsService: GoodsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { timeZone: 'Asia/Shanghai' })
  async handleAutoSync() {
    if (this.running) {
      this.logger.warn('price sync still running, skip this tick');
      return;
    }
    this.running = true;
    this.logger.log('Auto price sync starting');
    try {
      const summary = await this.goodsService.autoSyncEmptyPrices();
      this.logger.log(
        `Auto price sync done orders=${summary.orders} tried=${summary.itemsTried} ok=${summary.itemsOk} fail=${summary.itemsFail}`,
      );
    } catch (err) {
      this.logger.error(`Auto price sync failed: ${errorMessage(err)}`);
    } finally {
      this.running = false;
    }
  }
}
