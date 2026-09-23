import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { SiteModule } from '../site/site.module.js';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';

@Module({
  imports: [RbacModule, SiteModule],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}