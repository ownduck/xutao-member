export const SITE_SETTINGS_ROW_ID = 'default';
export const EXCHANGE_RATE_SETTINGS_ROW_ID = 'default';

/** Wallet ledger currency — fixed, independent of site default currency */
export const WALLET_CURRENCY = 'USD';

export const SUPPORTED_CURRENCIES = [
  'USD',
  'CNY',
  'EUR',
  'GBP',
  'JPY',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_EXCHANGE_RATES: Array<{
  currencyCode: SupportedCurrency;
  rateToBase: string;
}> = [
  { currencyCode: 'EUR', rateToBase: '1.08000000' },
  { currencyCode: 'GBP', rateToBase: '1.27000000' },
  { currencyCode: 'JPY', rateToBase: '0.00670000' },
  { currencyCode: 'CNY', rateToBase: '0.14000000' },
];

export function isSupportedCurrency(code: string): code is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(
    code.trim().toUpperCase(),
  );
}
