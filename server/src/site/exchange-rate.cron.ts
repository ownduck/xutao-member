import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { errorMessage } from '../common/format.js';
import { JuheExchangeService } from './juhe-exchange.service.js';

@Injectable()
export class ExchangeRateCron {
  private readonly logger = new Logger(ExchangeRateCron.name);

  constructor(private readonly juheExchangeService: JuheExchangeService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { timeZone: 'Asia/Shanghai' })
  async handleDailySync() {
    this.logger.log('Daily exchange-rate sync starting');
    try {
      const result = await this.juheExchangeService.syncFromJuhe();
      this.logger.log(
        `Daily sync done, updated=${result.updated.length}`,
      );
    } catch (err) {
      this.logger.error(`Daily sync failed: ${errorMessage(err)}`);
    }
  }
}
