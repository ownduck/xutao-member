import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  exchangeRateSettings,
  exchangeRates,
  siteSettings,
} from '../db/schema.js';
import {
  buildSnapshot,
  convertViaBase,
  normalizeCurrencyCode,
  type ExchangeRateSnapshot,
} from './currency-exchange.js';
import {
  DEFAULT_EXCHANGE_RATES,
  EXCHANGE_RATE_SETTINGS_ROW_ID,
  isSupportedCurrency,
  SITE_SETTINGS_ROW_ID,
  SUPPORTED_CURRENCIES,
  WALLET_CURRENCY,
} from './exchange-rate-config.js';

type SiteSettingsDto = {
  defaultCountryCode: string;
  defaultCurrencyCode: string;
};

type ExchangeRateDto = {
  currencyCode: string;
  rateToBase: number;
  updatedAt?: string | null;
};

type ExchangeRatesConfigDto = {
  baseCurrencyCode: string;
  rates: ExchangeRateDto[];
};

@Injectable()
export class SiteService {
  private readonly logger = new Logger(SiteService.name);

  async ensureDefaults() {
    const [settings] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.id, SITE_SETTINGS_ROW_ID))
      .limit(1);
    if (!settings) {
      await db.insert(siteSettings).values({
        id: SITE_SETTINGS_ROW_ID,
        defaultCountryCode: 'US',
        defaultCurrencyCode: 'USD',
      });
    }

    const [fxSettings] = await db
      .select()
      .from(exchangeRateSettings)
      .where(eq(exchangeRateSettings.id, EXCHANGE_RATE_SETTINGS_ROW_ID))
      .limit(1);
    if (!fxSettings) {
      await db.insert(exchangeRateSettings).values({
        id: EXCHANGE_RATE_SETTINGS_ROW_ID,
        baseCurrencyCode: WALLET_CURRENCY,
      });
    }

    const existing = await db.select().from(exchangeRates);
    if (existing.length === 0) {
      const now = new Date();
      await db.insert(exchangeRates).values(
        DEFAULT_EXCHANGE_RATES.map((row) => ({
          currencyCode: row.currencyCode,
          rateToBase: row.rateToBase,
          createdAt: now,
          updatedAt: now,
        })),
      );
      this.logger.log('Seeded default exchange rates');
    }
  }

  async getSettings(): Promise<SiteSettingsDto> {
    await this.ensureDefaults();
    const [row] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.id, SITE_SETTINGS_ROW_ID))
      .limit(1);
    return {
      defaultCountryCode: row.defaultCountryCode,
      defaultCurrencyCode: row.defaultCurrencyCode,
    };
  }

  async updateSettings(body: {
    defaultCountryCode?: string;
    defaultCurrencyCode?: string;
  }): Promise<SiteSettingsDto> {
    await this.ensureDefaults();
    const patch: {
      defaultCountryCode?: string;
      defaultCurrencyCode?: string;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (body.defaultCountryCode !== undefined) {
      const code = body.defaultCountryCode.trim().toUpperCase();
      if (!code) throw new BadRequestException('默认国家不能为空');
      patch.defaultCountryCode = code;
    }
    if (body.defaultCurrencyCode !== undefined) {
      const code = normalizeCurrencyCode(body.defaultCurrencyCode);
      if (!isSupportedCurrency(code)) {
        throw new BadRequestException(
          `不支持的币种，可选：${SUPPORTED_CURRENCIES.join(', ')}`,
        );
      }
      patch.defaultCurrencyCode = code;
    }

    await db
      .update(siteSettings)
      .set(patch)
      .where(eq(siteSettings.id, SITE_SETTINGS_ROW_ID));

    return this.getSettings();
  }

  async getExchangeRates(): Promise<ExchangeRatesConfigDto> {
    await this.ensureDefaults();
    const [settings] = await db
      .select()
      .from(exchangeRateSettings)
      .where(eq(exchangeRateSettings.id, EXCHANGE_RATE_SETTINGS_ROW_ID))
      .limit(1);
    const rows = await db.select().from(exchangeRates);
    return {
      baseCurrencyCode: settings?.baseCurrencyCode ?? WALLET_CURRENCY,
      rates: rows
        .map((r) => ({
          currencyCode: r.currencyCode,
          rateToBase: Number(r.rateToBase),
          updatedAt: r.updatedAt?.toISOString?.() ?? null,
        }))
        .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode)),
    };
  }

  async updateExchangeRates(body: {
    baseCurrencyCode?: string;
    rates: Array<{ currencyCode: string; rateToBase: number }>;
  }): Promise<ExchangeRatesConfigDto> {
    await this.ensureDefaults();
    const current = await this.getExchangeRates();
    const base = normalizeCurrencyCode(
      body.baseCurrencyCode ?? current.baseCurrencyCode ?? WALLET_CURRENCY,
    );
    if (!isSupportedCurrency(base)) {
      throw new BadRequestException(
        `不支持的基准币种，可选：${SUPPORTED_CURRENCIES.join(', ')}`,
      );
    }

    const cleaned: Array<{ currencyCode: string; rateToBase: string }> = [];
    for (const row of body.rates ?? []) {
      const code = normalizeCurrencyCode(row.currencyCode);
      if (code === base) continue;
      if (!isSupportedCurrency(code)) {
        throw new BadRequestException(`不支持的币种: ${code}`);
      }
      const rate = Number(row.rateToBase);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new BadRequestException(`汇率无效: ${code}`);
      }
      cleaned.push({
        currencyCode: code,
        rateToBase: rate.toFixed(8),
      });
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(exchangeRateSettings)
        .set({ baseCurrencyCode: base, updatedAt: now })
        .where(eq(exchangeRateSettings.id, EXCHANGE_RATE_SETTINGS_ROW_ID));

      await tx.delete(exchangeRates);
      if (cleaned.length > 0) {
        await tx.insert(exchangeRates).values(
          cleaned.map((row) => ({
            currencyCode: row.currencyCode,
            rateToBase: row.rateToBase,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
    });

    return this.getExchangeRates();
  }

  async upsertRates(
    rates: Array<{ currencyCode: string; rateToBase: number }>,
  ) {
    const config = await this.getExchangeRates();
    const base = normalizeCurrencyCode(config.baseCurrencyCode);
    const now = new Date();
    for (const row of rates) {
      const code = normalizeCurrencyCode(row.currencyCode);
      if (code === base) continue;
      const rate = Number(row.rateToBase);
      if (!Number.isFinite(rate) || rate <= 0) continue;

      const [existing] = await db
        .select()
        .from(exchangeRates)
        .where(eq(exchangeRates.currencyCode, code))
        .limit(1);
      if (existing) {
        await db
          .update(exchangeRates)
          .set({ rateToBase: rate.toFixed(8), updatedAt: now })
          .where(eq(exchangeRates.currencyCode, code));
      } else {
        await db.insert(exchangeRates).values({
          currencyCode: code,
          rateToBase: rate.toFixed(8),
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  async getSnapshot(): Promise<ExchangeRateSnapshot> {
    const config = await this.getExchangeRates();
    return buildSnapshot({
      baseCurrencyCode: config.baseCurrencyCode,
      rates: config.rates,
    });
  }

  async convertToWalletBase(
    amount: number,
    currencyCode: string,
  ): Promise<{ currencyCode: string; amountBase: number }> {
    const code = normalizeCurrencyCode(currencyCode);
    if (!isSupportedCurrency(code)) {
      throw new BadRequestException(
        `不支持的币种，可选：${SUPPORTED_CURRENCIES.join(', ')}`,
      );
    }
    const snapshot = await this.getSnapshot();
    const amountBase = convertViaBase(amount, code, WALLET_CURRENCY, snapshot);
    if (amountBase == null) {
      throw new BadRequestException(`缺少 ${code} 相对 ${WALLET_CURRENCY} 的汇率`);
    }
    return { currencyCode: code, amountBase };
  }
}
