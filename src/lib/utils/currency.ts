export const SUPPORTED_FIAT_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CNY',
  'INR',
  'AUD',
  'CAD',
  'CHF',
  'HKD',
  'SGD',
  'NZD',
  'SEK',
  'NOK',
  'MXN'
] as const

export type SupportedFiatCurrency = (typeof SUPPORTED_FIAT_CURRENCIES)[number]

export const EUR_REGIONS = new Set([
  'AT',
  'BE',
  'CY',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PT',
  'SK',
  'SI',
  'ES'
])

const REGION_TO_CURRENCY: Record<string, SupportedFiatCurrency> = {
  US: 'USD',
  GB: 'GBP',
  HK: 'HKD',
  CA: 'CAD',
  AU: 'AUD',
  NZ: 'NZD',
  CH: 'CHF',
  CN: 'CNY',
  JP: 'JPY',
  IN: 'INR',
  MX: 'MXN',
  SE: 'SEK',
  NO: 'NOK',
  SG: 'SGD'
}

export function isSupportedFiatCurrency(code: string): code is SupportedFiatCurrency {
  return SUPPORTED_FIAT_CURRENCIES.includes(code.toUpperCase() as SupportedFiatCurrency)
}

export function deriveDefaultFiatCurrencyFromLocale(locale: string): SupportedFiatCurrency {
  const clean = (locale || 'en-US').split('-u-')[0]

  let region: string | undefined
  try {
    const l = new (Intl as any).Locale(clean)
    region = l?.region
  } catch {
    region = undefined
  }

  if (!region) {
    const parts = clean.split('-')
    const maybeRegion = parts.find(p => p.length === 2 && p.toUpperCase() === p)
    region = maybeRegion
  }

  if (region && EUR_REGIONS.has(region)) return 'EUR'

  if (region && REGION_TO_CURRENCY[region]) return REGION_TO_CURRENCY[region]

  return 'USD'
}

export function deriveDefaultFiatCurrencyFromNavigator(): SupportedFiatCurrency {
  if (typeof navigator === 'undefined') return 'USD'
  const locale = (navigator.languages && navigator.languages[0]) || navigator.language || 'en-US'
  return deriveDefaultFiatCurrencyFromLocale(locale)
}

export function getCurrencyDisplayName(code: string, locale?: string): string {
  const upper = code.toUpperCase()
  try {
    const displayNames = new Intl.DisplayNames([locale || undefined].filter(Boolean) as string[], { type: 'currency' })
    return displayNames.of(upper) || upper
  } catch {
    return upper
  }
}
