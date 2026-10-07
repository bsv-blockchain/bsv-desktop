const localeDefault = Intl.NumberFormat().resolvedOptions().locale?.split('-u-')[0] || 'en-US'
const groupDefault = Intl.NumberFormat(localeDefault).formatToParts(10234.56).filter(p => p.type === 'group')[0].value
const decimalDefault = Intl.NumberFormat(localeDefault).formatToParts(1234.56).filter(p => p.type === 'decimal')[0].value

export const satoshisOptions = {
  fiatFormats: [
    {
      name: 'USD',
      // value suitable as first arg for Intl.NumberFormat or null for default locale
      locale: 'en-US',
      // value suitable as currency property of second arg for Intl.NumberFormat
      currency: 'USD'
    },
    {
      name: 'USD_locale',
      locale: null,
      currency: 'USD'
    },
    {
      name: 'EUR',
      locale: null,
      currency: 'EUR'
    },
    {
      name: 'GBP',
      locale: null,
      currency: 'GBP'
    }
  ],
  satsFormats: [
    {
      // Format name for settings choice lookup
      name: 'SATS',
      // One of: 'SATS', 'BSV', 'mBSV'
      // 100,000,000 SATS === 1000 mBSV === 1 BSV
      unit: 'SATS',
      // string to insert between integer and fraction parts, null for locale default
      decimal: null,
      // string to insert every three digits from decimal, null for locale default
      group: null,
      // full unit label
      label: 'satoshis',
      // abbreviated unit label
      abbrev: 'sats'
    },
    {
      name: 'SATS_Tone',
      unit: 'SATS',
      decimal: '.',
      group: '_',
      label: 'satoshis',
      abbrev: 'sats'
    },
    {
      name: 'mBSV',
      unit: 'mBSV',
      decimal: null,
      group: null,
      label: 'mBSV',
      abbrev: ''
    },
    {
      name: 'mBSV_Tone',
      unit: 'mBSV',
      decimal: '.',
      group: '_',
      label: 'mBSV',
      abbrev: ''
    },
    {
      name: 'BSV',
      unit: 'BSV',
      decimal: null,
      group: null,
      label: 'BSV',
      abbrev: ''
    },
    {
      name: 'BSV_Tone',
      unit: 'BSV',
      decimal: '.',
      group: '_',
      label: 'BSV',
      abbrev: ''
    }
  ],
  isFiatPreferred: false // If true, fiat format is preferred, else satsFormat
}

export const formatSatoshisAsFiat = (
  satoshis = NaN,
  satoshisPerUSD = null,
  format: any = null,
  settingsCurrency = 'SATS',
  eurPerUSD = 0.93,
  gbpPerUSD = 0.79,
  showFiatAsInteger = false
) => {
  if (settingsCurrency) {
    // See if requested currency matches a known fiat format, if not use 'USD'
    let fiatFormat = satoshisOptions.fiatFormats.find(f => f.name === settingsCurrency)
    if (!fiatFormat) fiatFormat = satoshisOptions.fiatFormats.find(f => f.name === 'USD')
    format = fiatFormat
  }
  format ??= satoshisOptions.fiatFormats[0]
  const locale = format.locale ?? localeDefault

  const usd = (satoshisPerUSD && Number.isInteger(Number(satoshis))) ? satoshis / satoshisPerUSD : NaN

  if (isNaN(usd)) return '...'

  let minDigits = 2
  let maxDigits
  const v = Math.abs(usd)
  if (v < 0.001) minDigits = 6
  else if (v < 0.01) minDigits = 5
  else if (v < 0.1) minDigits = 4
  else if (v < 1) minDigits = 3

  if (showFiatAsInteger) {
    minDigits = 0
    maxDigits = 0
  }

  if (!format || format.currency === 'USD') {
    const usdFormat = new Intl.NumberFormat(locale, { currency: 'USD', style: 'currency', minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits })
    return usdFormat.format(usd)
    // return (Math.abs(usd) >= 1) ? usdFormat.format(usd) : `${(usd * 100).toFixed(3)} ¢`
  } else if (format.currency === 'EUR') {
    const eur = usd * eurPerUSD
    if (isNaN(eur)) return '...'
    const eurFormat = new Intl.NumberFormat(locale, { currency: 'EUR', style: 'currency', minimumFractionDigits: minDigits })
    return eurFormat.format(eur)
  } else if (format.currency === 'GBP') {
    const gbp = usd * gbpPerUSD
    if (isNaN(gbp)) return '...'
    const gbpFormat = new Intl.NumberFormat(locale, { currency: 'GBP', style: 'currency', minimumFractionDigits: minDigits })
    return gbpFormat.format(gbp)
  }
}
export const formatSatoshis = (
  satoshis: any,
  showPlus = false,
  abbreviate = false,
  format: any = null,
  settingsCurrency = 'SATS'
) => {
  if (settingsCurrency) {
    // See if requested currency matches a known satoshis format, if not use 'SATS'
    let satsFormat = satoshisOptions.satsFormats.find(f => f.name === settingsCurrency)
    if (!satsFormat) satsFormat = satoshisOptions.satsFormats.find(f => f.name === 'SATS')
    format = satsFormat
  }
  format ??= satoshisOptions.satsFormats[0]
  const amount = Number(satoshis)
  if (!Number.isSafeInteger(amount)) return '---'
  const sign = amount < 0 ? '-' : showPlus ? '+' : ''
  const decimals = format.unit === 'BSV' ? 8 : format.unit === 'mBSV' ? 5 : 0
  const digits = Math.abs(amount).toFixed(0).padStart(decimals + 1, '0')
  const whole = decimals ? digits.slice(0, -decimals) : digits
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, '').padEnd(2, '0') : ''
  const group = format.group ?? groupDefault
  const decimal = format.decimal ?? decimalDefault
  // Group only the integer part. Separators inside decimal places make a
  // familiar currency amount look like an unrelated number.
  const integer = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group)
  const value = `${sign}${integer}${decimals ? decimal + fraction : ''}`
  const label = abbreviate ? (format.abbrev || format.label) : format.label
  return label ? `${value} ${label}` : value
}
