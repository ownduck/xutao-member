export const SUPPORTED_CURRENCIES = [
  'USD',
  'CNY',
  'EUR',
  'GBP',
  'JPY',
] as const

type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export const WALLET_CURRENCY = 'USD'

export const CURRENCY_LABELS: Record<string, string> = {
  USD: 'USD — 美元',
  CNY: 'CNY — 人民币',
  EUR: 'EUR — 欧元',
  GBP: 'GBP — 英镑',
  JPY: 'JPY — 日元',
}

export const CURRENCY_LABELS_LONG: Record<string, string> = {
  USD: 'USD — US Dollar — 美元',
  CNY: 'CNY — Chinese Yuan — 人民币',
  EUR: 'EUR — Euro — 欧元',
  GBP: 'GBP — British Pound — 英镑',
  JPY: 'JPY — Japanese Yen — 日元',
}

export function formatMoney(
  amount: string | number | null | undefined,
  currencyCode?: string | null,
): string {
  const n = Number(amount ?? 0)
  const code = (currencyCode || WALLET_CURRENCY).toUpperCase()
  return `${code} ${n.toFixed(2)}`
}

export type { SupportedCurrency }
