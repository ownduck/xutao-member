import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SiteService } from './site.service.js';
import {
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from './exchange-rate-config.js';

type JuheExchangeItem = {
  currencyF?: string;
  currencyT?: string;
  currencyF_Name?: string;
  currencyT_Name?: string;
  exchange?: string | number;
  result?: string | number;
};

type JuheExchangeResp = {
  error_code?: number;
  reason?: string;
  result?: JuheExchangeItem[];
};

const JUHE_URL = 'http://op.juhe.cn/onebox/exchange/currency';

@Injectable()
export class JuheExchangeService {
  private readonly logger = new Logger(JuheExchangeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly siteService: SiteService,
  ) {}

  private getAppKey(): string {
    const key = this.config.get<string>('JUHE_EXCHANGE_APP_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        '未配置 JUHE_EXCHANGE_APP_KEY，无法同步汇率',
      );
    }
    return key;
  }

  private async fetchPair(
    from: string,
    to: string,
  ): Promise<number | null> {
    const key = this.getAppKey();
    const url = new URL(JUHE_URL);
    url.searchParams.set('key', key);
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('version', '2');

    const res = await fetch(url.toString());
    const text = await res.text();
    this.logger.log(`Juhe ${from}->${to} status=${res.status}`);

    let data: JuheExchangeResp;
    try {
      data = JSON.parse(text) as JuheExchangeResp;
    } catch {
      this.logger.error(`Juhe ${from}->${to} invalid JSON: ${text.slice(0, 200)}`);
      return null;
    }

    if (data.error_code && data.error_code !== 0) {
      this.logger.error(
        `Juhe ${from}->${to} error_code=${data.error_code} reason=${data.reason}`,
      );
      return null;
    }

    const items = Array.isArray(data.result) ? data.result : [];
    for (const item of items) {
      const f = String(item.currencyF ?? '').toUpperCase();
      const t = String(item.currencyT ?? '').toUpperCase();
      if (f === from && t === to) {
        const exchange = Number(item.exchange ?? item.result);
        if (Number.isFinite(exchange) && exchange > 0) return exchange;
      }
    }

    for (const item of items) {
      const exchange = Number(item.exchange ?? item.result);
      if (Number.isFinite(exchange) && exchange > 0) return exchange;
    }
    return null;
  }

  /**
   * Pull CNY-anchored pairs from Juhe, then convert to the configured FX base.
   * rate_to_base(X) = 1 X = ? base
   */
  async syncFromJuhe(): Promise<{
    ok: boolean;
    baseCurrencyCode: string;
    updated: Array<{ currencyCode: string; rateToBase: number }>;
  }> {
    await this.siteService.ensureDefaults();
    const config = await this.siteService.getExchangeRates();
    const base = config.baseCurrencyCode.toUpperCase() as SupportedCurrency;

    const peers = SUPPORTED_CURRENCIES.filter((c) => c !== 'CNY');
    const cnyToPeer = new Map<string, number>();

    if (base !== 'CNY') {
      const eCnyBase = await this.fetchPair('CNY', base);
      if (eCnyBase == null) {
        throw new ServiceUnavailableException(`拉取 CNY→${base} 汇率失败`);
      }
      cnyToPeer.set(base, eCnyBase);
    }

    for (const code of peers) {
      if (code === base) continue;
      try {
        const eCnyX = await this.fetchPair('CNY', code);
        if (eCnyX == null || eCnyX <= 0) {
          this.logger.warn(`Skip ${code}: missing CNY→${code}`);
          continue;
        }
        cnyToPeer.set(code, eCnyX);
      } catch (err) {
        this.logger.error(
          `Failed CNY→${code}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const updated: Array<{ currencyCode: string; rateToBase: number }> = [];

    if (base === 'CNY') {
      for (const [code, eCnyX] of cnyToPeer) {
        const rateToBase = 1 / eCnyX;
        if (Number.isFinite(rateToBase) && rateToBase > 0) {
          updated.push({ currencyCode: code, rateToBase });
        }
      }
    } else {
      const eCnyBase = cnyToPeer.get(base);
      if (eCnyBase == null) {
        throw new ServiceUnavailableException(`缺少 CNY→${base} 汇率`);
      }
      updated.push({ currencyCode: 'CNY', rateToBase: eCnyBase });
      for (const [code, eCnyX] of cnyToPeer) {
        if (code === base) continue;
        const rateToBase = eCnyBase / eCnyX;
        if (Number.isFinite(rateToBase) && rateToBase > 0) {
          updated.push({ currencyCode: code, rateToBase });
        }
      }
    }

    await this.siteService.updateExchangeRates({
      baseCurrencyCode: base,
      rates: updated,
    });

    this.logger.log(
      `Synced to base=${base}: ${updated.map((r) => `${r.currencyCode}=${r.rateToBase}`).join(', ')}`,
    );
    return { ok: true, baseCurrencyCode: base, updated };
  }
}
