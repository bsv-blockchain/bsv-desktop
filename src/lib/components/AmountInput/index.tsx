import { FC, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { InputAdornment, TextField, TextFieldProps } from '@mui/material'
import { WalletContext } from '../../WalletContext'
import { ExchangeRateContext } from '../AmountDisplay/ExchangeRateContextProvider'

/**
 * The unit an amount input accepts, derived from the user's preferred currency
 * setting. Mirrors the semantics used by AmountDisplay so that what the user
 * reads and what the user types are always in the same denomination.
 */
export type AmountUnit =
  | { kind: 'sats' }
  | { kind: 'bsv' }
  | { kind: 'fiat'; code: 'USD' | 'EUR' | 'GBP' }

const SATS_PER_BSV = 1e8

const UNIT_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' }

/**
 * Resolves the user's preferred currency into a unit for amount entry, along
 * with the conversions between that unit and satoshis. Every amount input in
 * the app should go through this so a user who prefers sats never has to count
 * zeros in a BSV field (and vice versa).
 */
export const useAmountUnit = () => {
  const { settings } = useContext(WalletContext)
  const rates = useContext<any>(ExchangeRateContext)
  const { satoshisPerUSD, eurPerUSD, gbpPerUSD } = rates || {}

  const rawCurrency: string = String(
    (settings as any)?.currency ??
    (settings as any)?.fiatCurrency ??
    (settings as any)?.displayCurrency ??
    ''
  ).toUpperCase()

  const unit: AmountUnit = useMemo(() => {
    if (/SAT/i.test(rawCurrency)) return { kind: 'sats' }
    if (rawCurrency === 'BSV' || /BITCOIN/i.test(rawCurrency)) return { kind: 'bsv' }
    if (rawCurrency === 'USD' || rawCurrency === 'EUR' || rawCurrency === 'GBP') {
      return { kind: 'fiat', code: rawCurrency }
    }
    // anything else -> sats (matches AmountDisplay behavior)
    return { kind: 'sats' }
  }, [rawCurrency])

  const unitLabel = unit.kind === 'sats' ? 'sats' : unit.kind === 'bsv' ? 'BSV' : unit.code
  const adornmentLabel =
    unit.kind === 'sats' ? 'sats'
      : unit.kind === 'bsv' ? 'BSV'
        : UNIT_SYMBOLS[unit.code] ?? unit.code

  const decimals = unit.kind === 'sats' ? 0 : unit.kind === 'bsv' ? 8 : 2
  const step = unit.kind === 'sats' ? 1 : unit.kind === 'bsv' ? 0.00000001 : 0.01
  const placeholder = unit.kind === 'sats' ? '0' : unit.kind === 'bsv' ? '0.00000000' : '0.00'

  const ratesReady =
    unit.kind !== 'fiat' ? true
      : unit.code === 'USD' ? !!satoshisPerUSD
        : unit.code === 'EUR' ? (!!satoshisPerUSD && !!eurPerUSD)
          : unit.code === 'GBP' ? (!!satoshisPerUSD && !!gbpPerUSD)
            : false

  /** satoshis -> the unit the user types in */
  const satsToInput = useCallback((sats: number): number => {
    if (!Number.isFinite(sats)) return NaN
    if (unit.kind === 'sats') return sats
    if (unit.kind === 'bsv') return sats / SATS_PER_BSV

    if (!satoshisPerUSD) return NaN
    const usd = sats / satoshisPerUSD
    if (unit.code === 'USD') return usd
    if (unit.code === 'EUR') return eurPerUSD ? usd * eurPerUSD : NaN
    if (unit.code === 'GBP') return gbpPerUSD ? usd * gbpPerUSD : NaN
    return NaN
  }, [unit, satoshisPerUSD, eurPerUSD, gbpPerUSD])

  /** the unit the user types in -> satoshis */
  const inputToSats = useCallback((amount: number): number => {
    if (!Number.isFinite(amount)) return NaN
    if (unit.kind === 'sats') return Math.round(amount)
    if (unit.kind === 'bsv') return Math.round(amount * SATS_PER_BSV)

    if (!satoshisPerUSD) return NaN
    let usd = amount
    if (unit.code === 'EUR') {
      if (!eurPerUSD) return NaN
      usd = amount / eurPerUSD
    } else if (unit.code === 'GBP') {
      if (!gbpPerUSD) return NaN
      usd = amount / gbpPerUSD
    }
    return Math.round(usd * satoshisPerUSD)
  }, [unit, satoshisPerUSD, eurPerUSD, gbpPerUSD])

  /** satoshis -> the string to seed the input field with */
  const formatForInput = useCallback((sats: number): string => {
    const value = satsToInput(sats)
    if (!Number.isFinite(value)) return ''
    if (unit.kind === 'sats') return String(Math.round(value))
    // Trim trailing zeros so 0.50000000 reads as 0.5
    return value.toFixed(decimals).replace(/\.?0+$/, '')
  }, [satsToInput, unit, decimals])

  /** satoshis -> a human-readable string in the preferred unit, e.g. for toasts */
  const formatWithUnit = useCallback((sats: number): string => {
    const value = satsToInput(sats)
    if (!Number.isFinite(value)) return '...'
    if (unit.kind === 'fiat') {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: unit.code }).format(value)
    }
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals }).format(value)} ${unitLabel}`
  }, [satsToInput, unit, decimals, unitLabel])

  return {
    unit,
    unitLabel,
    adornmentLabel,
    decimals,
    step,
    placeholder,
    ratesReady,
    satsToInput,
    inputToSats,
    formatForInput,
    formatWithUnit
  }
}

type AmountInputProps = Omit<TextFieldProps, 'value' | 'onChange' | 'type'> & {
  /** Current amount in satoshis, or null when the field is empty. */
  valueSats: number | null
  /** Called with the amount in satoshis, or null when the field is cleared. */
  onChangeSats: (satoshis: number | null) => void
  /** Show the unit as a start adornment instead of relying on the label. */
  showAdornment?: boolean
}

/**
 * A currency-aware amount field. The caller always deals in satoshis; the user
 * always types in whichever unit they picked in Settings.
 */
export const AmountInput: FC<AmountInputProps> = ({
  valueSats,
  onChangeSats,
  showAdornment = true,
  placeholder,
  inputProps,
  InputProps,
  sx,
  disabled,
  ...rest
}) => {
  const {
    unit, adornmentLabel, step, placeholder: unitPlaceholder,
    ratesReady, formatForInput, inputToSats
  } = useAmountUnit()

  // A fiat field is unusable until the exchange rate lands.
  const awaitingRates = unit.kind === 'fiat' && !ratesReady

  // The raw text the user is editing. Kept separate from valueSats so partial
  // input ('0.', '') survives round-tripping through satoshis.
  const [text, setText] = useState(() => (valueSats === null ? '' : formatForInput(valueSats)))
  const lastEmitted = useRef<number | null>(valueSats)

  // Re-seed the field when the amount changes from outside, or when the user
  // switches their preferred currency mid-edit.
  useEffect(() => {
    if (valueSats === lastEmitted.current) return
    setText(valueSats === null ? '' : formatForInput(valueSats))
    lastEmitted.current = valueSats
  }, [valueSats, formatForInput])

  useEffect(() => {
    if (valueSats === null) return
    setText(formatForInput(valueSats))
    // Only on unit change — valueSats is handled by the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit.kind, (unit as any).code])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setText(raw)
    if (raw.trim() === '') {
      lastEmitted.current = null
      onChangeSats(null)
      return
    }
    const parsed = parseFloat(raw)
    const sats = Number.isFinite(parsed) ? inputToSats(parsed) : NaN
    const next = Number.isFinite(sats) ? sats : null
    lastEmitted.current = next
    onChangeSats(next)
  }

  return (
    <TextField
      {...rest}
      value={text}
      onChange={handleChange}
      type="number"
      disabled={disabled || awaitingRates}
      placeholder={placeholder ?? unitPlaceholder}
      inputProps={{ min: 0, step, ...inputProps }}
      InputProps={{
        ...(showAdornment
          ? { startAdornment: <InputAdornment position="start">{adornmentLabel}</InputAdornment> }
          : {}),
        ...InputProps
      }}
      sx={{
        '& input[type=number]': { MozAppearance: 'textfield' },
        '& input[type=number]::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
        '& input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
        ...sx
      }}
    />
  )
}

export default AmountInput
