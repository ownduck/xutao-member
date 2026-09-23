import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { SiteModule } from '../site/site.module.js';
import { AmazonPriceService } from './amazon-price.service.js';
import { GoodsController } from './goods.controller.js';
import { GoodsPriceSyncCron } from './goods-price-sync.cron.js';
import { GoodsService } from './goods.service.js';

@Module({
  imports: [RbacModule, SiteModule, FinanceModule],
  controllers: [GoodsController],
  providers: [GoodsService, AmazonPriceService, GoodsPriceSyncCron],
  exports: [GoodsService],
})
export class GoodsModule {}
