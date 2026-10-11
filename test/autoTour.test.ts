import { describe, it, expect } from 'vitest'
import { markTourSeen, shouldAutoStartTour, tourSeenKey } from '../src/lib/components/tour/autoTour'

function memory() {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } }
}

describe('auto-start tour', () => {
  const profileId = [1, 2, 3]

  it('keys by base64 profile id', () => {
    expect(tourSeenKey(profileId)).toBe('tourSeen_AQID')
  })

  it('starts for a loaded zero balance on a profile that has not seen it', () => {
    expect(shouldAutoStartTour({ balance: 0, loading: false, profileId, storage: memory() })).toBe(true)
  })

  it('does not start while loading, with funds, or when the balance is unknown', () => {
    const storage = memory()
    expect(shouldAutoStartTour({ balance: 0, loading: true, profileId, storage })).toBe(false)
    expect(shouldAutoStartTour({ balance: 1, loading: false, profileId, storage })).toBe(false)
    expect(shouldAutoStartTour({ balance: null, loading: false, profileId, storage })).toBe(false)
    expect(shouldAutoStartTour({ balance: 0, loading: false, profileId: null, storage })).toBe(false)
  })

  it('starts only once per profile', () => {
    const storage = memory()
    markTourSeen(profileId, storage)
    expect(shouldAutoStartTour({ balance: 0, loading: false, profileId, storage })).toBe(false)
    expect(shouldAutoStartTour({ balance: 0, loading: false, profileId: [9], storage })).toBe(true)
  })

  it('never throws and never auto-starts when storage is blocked', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(() => markTourSeen(profileId, broken)).not.toThrow()
    expect(shouldAutoStartTour({ balance: 0, loading: false, profileId, storage: broken })).toBe(false)
  })
})
