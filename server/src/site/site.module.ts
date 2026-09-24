import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { JuheExchangeService } from './juhe-exchange.service.js';
import { SiteController } from './site.controller.js';
import { SiteService } from './site.service.js';

@Module({
  imports: [RbacModule],
  controllers: [SiteController],
  providers: [SiteService, JuheExchangeService],
  exports: [SiteService, JuheExchangeService],
})
export class SiteModule {}
