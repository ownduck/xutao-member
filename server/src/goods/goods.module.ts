import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { SiteModule } from '../site/site.module.js';
import { AmazonPriceService } from './amazon-price.service.js';
import { GoodsController } from './goods.controller.js';
import { GoodsService } from './goods.service.js';

@Module({
  imports: [RbacModule, SiteModule, FinanceModule],
  controllers: [GoodsController],
  providers: [GoodsService, AmazonPriceService],
  exports: [GoodsService],
})
export class GoodsModule {}
