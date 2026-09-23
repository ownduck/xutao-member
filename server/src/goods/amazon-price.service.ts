import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type BrightRow = {
  final_price?: number | string;
  price?: number | string;
  list_price?: number | string;
  error?: string;
  error_code?: string;
  url?: string;
};

@Injectable()
export class AmazonPriceService {
  private readonly logger = new Logger(AmazonPriceService.name);

  constructor(private readonly config: ConfigService) {}

  private getToken(): string {
    const token = this.config.get<string>('BRIGHTDATA_API_TOKEN')?.trim();
    if (!token) {
      throw new ServiceUnavailableException(
        '未配置 BRIGHTDATA_API_TOKEN，无法抓取 Amazon 价格',
      );
    }
    return token;
  }

  private getDatasetId(): string {
    return (
      this.config.get<string>('BRIGHTDATA_AMAZON_DATASET_ID')?.trim() ||
      'gd_l7q7dkf244hwjntr0'
    );
  }

  private extractUsdPrice(payload: unknown): number | null {
    const rows: BrightRow[] = Array.isArray(payload)
      ? (payload as BrightRow[])
      : payload && typeof payload === 'object'
        ? [payload as BrightRow]
        : [];

    for (const row of rows) {
      if (row.error || row.error_code) continue;
      for (const key of ['final_price', 'price', 'list_price'] as const) {
        const raw = row[key];
        if (raw == null || raw === '') continue;
        const n =
          typeof raw === 'number'
            ? raw
            : Number(String(raw).replace(/[^0-9.]/g, ''));
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    return null;
  }

  async fetchUsdPrice(amazonUrl: string): Promise<number> {
    const url = amazonUrl.trim();
    if (!url) throw new BadRequestException('商品 URL 为空');

    const token = this.getToken();
    const datasetId = this.getDatasetId();
    const endpoint = `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${encodeURIComponent(datasetId)}&notify=false&include_errors=true`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: [{ url, zipcode: '94107', language: '' }],
          limit_per_input: null,
        }),
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        this.logger.error(`BrightData HTTP ${res.status}: ${text.slice(0, 500)}`);
        throw new ServiceUnavailableException(
          `抓取失败 (HTTP ${res.status})`,
        );
      }

      let data: unknown;
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        throw new ServiceUnavailableException('抓取返回非 JSON');
      }

      const price = this.extractUsdPrice(data);
      if (price == null) {
        throw new BadRequestException('未能解析到有效商品价格');
      }
      return price;
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) {
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ServiceUnavailableException('抓取超时（120秒）');
      }
      this.logger.error(
        `BrightData error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException('抓取 Amazon 价格失败');
    } finally {
      clearTimeout(timer);
    }
  }
}
