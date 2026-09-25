import { config } from 'dotenv';
import { createServer } from 'node:net';
import type { INestApplication } from '@nestjs/common';

config({ path: '.env' });

if (!process.env.CRON_SECRET?.trim()) {
  process.env.CRON_SECRET = 'e2e-cron-secret-local';
}

/** Vitest e2e: disable @Cron so schedulers don't fire mid-suite. */
process.env.VERCEL = '1';

export type E2eApp = {
  app: INestApplication;
  baseUrl: string;
  origin: string;
  cronSecret: string;
  close: () => Promise<void>;
  /** Restore real AmazonPriceService.fetchUsdPrice (for live Bright Data specs). */
  enableLiveBrightData: () => void;
  /** Re-apply stub that fails fast without network. */
  disableLiveBrightData: () => void;
};

let boot: Promise<E2eApp> | null = null;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

export function ensureE2eApp(): Promise<E2eApp> {
  if (!boot) {
    boot = (async () => {
      const port = await getFreePort();
      process.env.PORT = String(port);
      process.env.BETTER_AUTH_URL = `http://127.0.0.1:${port}`;

      const { NestFactory } = await import('@nestjs/core');
      const { AppModule } = await import('../../src/app.module.js');

      const app = await NestFactory.create(AppModule, {
        bodyParser: false,
        logger: ['error', 'warn'],
      });
      process.env.VERCEL = '1';

      const { ServiceUnavailableException } = await import('@nestjs/common');
      const { AmazonPriceService } = await import(
        '../../src/goods/amazon-price.service.js'
      );
      const { GoodsService } = await import('../../src/goods/goods.service.js');
      const { JuheExchangeService } = await import(
        '../../src/site/juhe-exchange.service.js'
      );

      const priceSvc = app.get(AmazonPriceService);
      const proto = Object.getPrototypeOf(priceSvc) as AmazonPriceService & {
        fetchUsdPrice: AmazonPriceService['fetchUsdPrice'];
      };
      const realFetchUsdPrice = proto.fetchUsdPrice;

      const applyFetchStub = () => {
        proto.fetchUsdPrice = async function stubFetchUsdPrice() {
          throw new ServiceUnavailableException(
            'e2e: Bright Data disabled in Vitest',
          );
        };
      };
      const restoreFetch = () => {
        proto.fetchUsdPrice = realFetchUsdPrice;
      };
      applyFetchStub();

      // Keep real syncItemPrice/syncPrices so status guards still run.
      // Only stub cron bulk scrape so price-sync doesn't walk the whole DB.
      const goodsSvc = app.get(GoodsService);
      Object.defineProperty(goodsSvc, 'autoSyncEmptyPrices', {
        configurable: true,
        value: async () => {
          await new Promise((r) => setTimeout(r, 400));
          return {
            orders: 0,
            itemsTried: 0,
            itemsOk: 0,
            itemsFail: 0,
          };
        },
      });

      const juhe = app.get(JuheExchangeService);
      Object.defineProperty(juhe, 'syncFromJuhe', {
        configurable: true,
        value: async () => ({ updated: [] as string[] }),
      });

      {
        const { sql } = await import('drizzle-orm');
        const { db } = await import('../../src/db/index.js');
        await db.execute(
          sql`UPDATE cron_job_lock SET locked_until = NOW() - INTERVAL '1 second'`,
        );
      }

      const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5288';
      app.enableCors({ origin, credentials: true });
      await app.listen(port, '127.0.0.1');

      return {
        app,
        baseUrl: `http://127.0.0.1:${port}`,
        origin,
        cronSecret: process.env.CRON_SECRET!,
        close: async () => {
          await app.close();
          boot = null;
        },
        enableLiveBrightData: restoreFetch,
        disableLiveBrightData: applyFetchStub,
      };
    })();
  }
  return boot;
}
