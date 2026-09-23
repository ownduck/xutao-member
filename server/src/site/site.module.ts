import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { ExchangeRateCron } from './exchange-rate.cron.js';
import { JuheExchangeService } from './juhe-exchange.service.js';
import { SiteController } from './site.controller.js';
import { SiteService } from './site.service.js';

@Module({
  imports: [RbacModule],
  controllers: [SiteController],
  providers: [SiteService, JuheExchangeService, ExchangeRateCron],
  exports: [SiteService],
})
export class SiteModule {}
