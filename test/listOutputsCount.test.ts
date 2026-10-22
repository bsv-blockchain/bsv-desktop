import { expect, test } from 'vitest'
import { readCount } from '../src/lib/utils/listOutputsCount'

test('accepts numbers and canonical decimal strings', () => {
  expect(readCount(0, 'n')).toBe(0)
  expect(readCount(1_234_567, 'n')).toBe(1234567)
  expect(readCount('0', 'n')).toBe(0)
  expect(readCount('1234567', 'n')).toBe(1234567)
  expect(readCount('9007199254740991', 'n')).toBe(9007199254740991)
  expect(readCount(Number.MAX_SAFE_INTEGER, 'n')).toBe(Number.MAX_SAFE_INTEGER)
})

test('rejects anything that is not an exact safe count', () => {
  for (const bad of [
    '9007199254740992', '18446744073709551615', '01', '-1', '1e3', '', ' 1', '1 ', '+1', '1.0', '0x10',
    1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, null, undefined, {}, 10n
  ] as const) {
    expect(() => readCount(bad as any, 'Outputs')).toThrow('Outputs is not a safe non-negative integer count')
  }
})
