import { describe, expect, it } from 'vitest'
import { formatSatoshis } from '../src/lib/components/AmountDisplay/amountFormatHelpers'

const standard = { unit: 'BSV', decimal: '.', group: ',', label: 'BSV', abbrev: '' }
describe('readable and precise wallet amounts', () => {
  it('keeps decimal digits together and trims unnecessary zeros', () => {
    expect(formatSatoshis(14215000, false, false, standard, '')).toBe('0.14215 BSV')
    expect(formatSatoshis(100000000, false, false, standard, '')).toBe('1.00 BSV')
  })
  it('preserves a single satoshi and the payment direction', () => {
    expect(formatSatoshis(1, true, false, standard, '')).toBe('+0.00000001 BSV')
    expect(formatSatoshis(-1, true, false, standard, '')).toBe('-0.00000001 BSV')
  })
  it('groups only integer digits and retains a unit when abbreviated', () => {
    expect(formatSatoshis(123456789000, false, true, standard, '')).toBe('1,234.56789 BSV')
  })
  it('rejects fractional or unsafe satoshi counts', () => {
    expect(formatSatoshis(0.5)).toBe('---')
    expect(formatSatoshis(Number.MAX_SAFE_INTEGER + 1)).toBe('---')
  })
})
