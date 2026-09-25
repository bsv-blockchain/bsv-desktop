import fs from 'fs'
import path from 'path'
import { describe, expect, test } from 'vitest'
import { spendingProgress } from '../src/lib/utils/spendingProgress'

// querySpentSince (wallet-toolbox) returns the amount spent this month as a
// positive number: stored actions carry negative net satoshis and it sums
// `a - e.satoshis`.
describe('spendingProgress', () => {
  test('shows the positive amount spent and its share of the limit', () => {
    expect(spendingProgress(1_158_283, 1_731_102)).toEqual({ spent: 1_158_283, percent: (1_158_283 / 1_731_102) * 100 })
  })

  test('nothing spent', () => {
    expect(spendingProgress(0, 1_000)).toEqual({ spent: 0, percent: 0 })
  })

  test('caps the bar at 100% once the limit is exceeded', () => {
    expect(spendingProgress(2_500, 1_000)).toEqual({ spent: 2_500, percent: 100 })
  })

  test('never shows a negative amount or bar (e.g. net incoming this month)', () => {
    expect(spendingProgress(-500, 1_000)).toEqual({ spent: 0, percent: 0 })
  })

  test('a zero limit does not divide by zero', () => {
    expect(spendingProgress(10, 0)).toEqual({ spent: 10, percent: 100 })
    expect(spendingProgress(0, 0)).toEqual({ spent: 0, percent: 0 })
  })
})

describe('SpendingAuthorizationList wiring', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/lib/components/SpendingAuthorizationList.tsx'),
    'utf8'
  )

  test('renders the meter through spendingProgress, without negating the spent total', () => {
    expect(source).toMatch(/spendingProgress\(currentSpending, authorization\.authorizedAmount\)/)
    expect(source).not.toMatch(/currentSpending \* -1/)
  })

  test('a cached figure does not stop a fresh query (silent spends must show up)', () => {
    const start = source.indexOf('if (showedCache) {')
    expect(start).toBeGreaterThan(-1)
    const cacheHit = source.slice(start)
    const cacheBlock = cacheHit.slice(0, cacheHit.indexOf('try {'))
    expect(cacheBlock).not.toMatch(/\breturn;/)
  })
})
