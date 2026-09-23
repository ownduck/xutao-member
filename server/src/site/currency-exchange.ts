export type ExchangeRateSnapshot = {
  baseCurrencyCode: string;
  ratesByCurrency: Record<string, number>;
};

export function normalizeCurrencyCode(value: string): string {
  return value.trim().toUpperCase();
}

export function roundHalfUp(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function buildSnapshot(input: {
  baseCurrencyCode: string;
  rates: Array<{ currencyCode: string; rateToBase: number | string }>;
}): ExchangeRateSnapshot {
  const baseCurrencyCode = normalizeCurrencyCode(input.baseCurrencyCode);
  const ratesByCurrency: Record<string, number> = {
    [baseCurrencyCode]: 1,
  };
  for (const row of input.rates) {
    const code = normalizeCurrencyCode(row.currencyCode);
    if (code === baseCurrencyCode) continue;
    const rate = Number(row.rateToBase);
    if (Number.isFinite(rate) && rate > 0) {
      ratesByCurrency[code] = rate;
    }
  }
  return { baseCurrencyCode, ratesByCurrency };
}

function getRateToBase(
  currency: string,
  snapshot: ExchangeRateSnapshot,
): number | null {
  const code = normalizeCurrencyCode(currency);
  if (code === snapshot.baseCurrencyCode) return 1;
  const rate = snapshot.ratesByCurrency[code];
  return rate && rate > 0 ? rate : null;
}

/**
 * Convert amount from `fromCurrency` to `toCurrency` via base rates.
 * amountBase = round_half_up(amount * rateToBase(from) / rateToBase(to), 2)
 */
export function convertViaBase(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  snapshot: ExchangeRateSnapshot,
): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);
  if (from === to) return roundHalfUp(amount);

  const fromRate = getRateToBase(from, snapshot);
  const toRate = getRateToBase(to, snapshot);
  if (fromRate == null || toRate == null) return null;

  return roundHalfUp(amount * (fromRate / toRate));
}
