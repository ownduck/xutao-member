import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, expectStatus } from './helpers/assert.js';
import { ensureE2eApp } from './helpers/app.js';
import { api, SEED, signIn } from './helpers/auth.js';

describe('site', () => {
  let admin = '';
  let dealer = '';

  beforeAll(async () => {
    await ensureE2eApp();
    admin = await signIn(SEED.admin.email, SEED.admin.password);
    dealer = await signIn(SEED.dealer.email, SEED.dealer.password);
  });

  it('settings get/put/defaults', async () => {
    const s = await api('/api/site/settings', admin);
    expectOk(s);

    const put = await api('/api/site/settings', admin, {
      method: 'PUT',
      body: JSON.stringify({
        defaultCountryCode: 'US',
        defaultCurrencyCode: 'USD',
      }),
    });
    expectOk(put);

    const def = await api('/api/site/settings/defaults', admin);
    expectOk(def);
  });

  it('exchange rates get/put/sync', async () => {
    const rates = await api('/api/site/exchange-rates', admin);
    expectOk(rates);
    const cfg = rates.data as {
      baseCurrencyCode: string;
      rates: Array<{ currencyCode: string; rateToBase: number }>;
    };

    const putRates = await api('/api/site/exchange-rates', admin, {
      method: 'PUT',
      body: JSON.stringify({
        baseCurrencyCode: cfg.baseCurrencyCode || 'USD',
        rates: (cfg.rates || []).map((r) => ({
          currencyCode: r.currencyCode,
          rateToBase: Number(r.rateToBase) || 1,
        })),
      }),
    });
    expectOk(putRates);

    const sync = await api('/api/site/exchange-rates/sync', admin, {
      method: 'POST',
    });
    expectStatus(sync, [200, 201, 503], 'rates sync');
  });

  it('dealer cannot update settings', async () => {
    const put = await api('/api/site/settings', dealer, {
      method: 'PUT',
      body: JSON.stringify({
        defaultCountryCode: 'US',
        defaultCurrencyCode: 'USD',
      }),
    });
    expectStatus(put, [401, 403]);
  });
});
