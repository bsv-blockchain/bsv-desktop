const localeDefault = Intl.NumberFormat().resolvedOptions().locale
const groupDefault = Intl.NumberFormat().formatToParts(10234.56).filter(p => p.type === 'group')[0].value
const decimalDefault = Intl.NumberFormat().formatToParts(1234.56).filter(p => p.type === 'decimal')[0].value

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
  let s: any = (Number.isInteger(Number(satoshis))) ? Number(satoshis) : null
  if (s === null) { return '---' }
  const sign = s < 0 ? '-' : showPlus ? '+' : ''
  s = Math.abs(s).toFixed(0)
  // There are at most 21 some odd million hundred million satoshis.
  // We format this with the following separators.
  // Note that the decimal only appears after a hundred million satoshis.
  // 21_000_000.000_000_00
  const g = format.group ?? groupDefault
  const d = format.decimal ?? decimalDefault
  let p, sMinLen
  switch (format.unit) {
    case 'BSV': sMinLen = 9; p = [[2, g], [3, g], [3, d], [3, g], [3, g]]; break
    case 'mBSV': sMinLen = 6; p = [[2, g], [3, d], [3, g], [3, g], [3, g]]; break
    default:
      sMinLen = 0; p = [[3, g], [3, g], [3, g], [3, g], [3, g]]; break
  }
  let r = ''
  while (s.length < sMinLen) s = '0' + s
  while (s.length > 0) {
    if (p.length === 0) {
      r = s + r
      s = ''
    } else {
      const q = p.shift()!
      r = s.substring(s.length - q[0]) + r
      if (s.length > q[0]) {
        r = q[1] + r
        s = s.substring(0, s.length - q[0])
      } else {
        s = ''
      }
    }
  }
  r = `${sign}${r}`
  const label = abbreviate ? format.abbrev : format.label
  if (label && label.length > 0) { r = `${r} ${label}` }
  return r
}
