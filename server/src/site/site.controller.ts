import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { JuheExchangeService } from './juhe-exchange.service.js';
import { SiteService } from './site.service.js';

@Controller('api/site')
@UseGuards(PermissionGuard)
export class SiteController {
  constructor(
    private readonly siteService: SiteService,
    private readonly juheExchangeService: JuheExchangeService,
  ) {}

  @Get('settings')
  @RequirePermission('site_config', 'ro')
  getSettings() {
    return this.siteService.getSettings();
  }

  @Put('settings')
  @RequirePermission('site_config', 'rw')
  updateSettings(
    @Body()
    body: { defaultCountryCode?: string; defaultCurrencyCode?: string },
  ) {
    return this.siteService.updateSettings(body);
  }

  /** Lightweight read for finance forms (default currency). */
  @Get('settings/defaults')
  @RequirePermission('recharge', 'ro')
  getDefaultsForFinance() {
    return this.siteService.getSettings();
  }

  @Get('exchange-rates')
  @RequirePermission('exchange_rate', 'ro')
  getExchangeRates() {
    return this.siteService.getExchangeRates();
  }

  @Put('exchange-rates')
  @RequirePermission('exchange_rate', 'rw')
  updateExchangeRates(
    @Body()
    body: {
      baseCurrencyCode?: string;
      rates: Array<{ currencyCode: string; rateToBase: number }>;
    },
  ) {
    return this.siteService.updateExchangeRates(body);
  }

  @Post('exchange-rates/sync')
  @RequirePermission('exchange_rate', 'rw')
  syncExchangeRates() {
    return this.juheExchangeService.syncFromJuhe();
  }
}
