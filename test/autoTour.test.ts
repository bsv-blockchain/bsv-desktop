import { describe, it, expect } from 'vitest'
import { isDefaultProfile, markTourSeen, shouldAutoStartTour, tourSeenKey } from '../src/lib/components/tour/autoTour'

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
    expect(shouldAutoStartTour({ balance: 0, loading: false, profileId, defaultProfile: true, storage: memory() })).toBe(true)
  })

  it('does not start while loading, with funds, or when the balance is unknown', () => {
    const storage = memory()
    expect(shouldAutoStartTour({ balance: 0, loading: true, profileId, defaultProfile: true, storage })).toBe(false)
    expect(shouldAutoStartTour({ balance: 1, loading: false, profileId, defaultProfile: true, storage })).toBe(false)
    expect(shouldAutoStartTour({ balance: null, loading: false, profileId, defaultProfile: true, storage })).toBe(false)
    expect(shouldAutoStartTour({ balance: 0, loading: false, profileId: null, defaultProfile: true, storage })).toBe(false)
  })

  it('starts only once per profile', () => {
    const storage = memory()
    markTourSeen(profileId, storage)
    expect(shouldAutoStartTour({ balance: 0, loading: false, profileId, defaultProfile: true, storage })).toBe(false)
    expect(shouldAutoStartTour({ balance: 0, loading: false, profileId: [9], defaultProfile: true, storage })).toBe(true)
  })

  it('never throws and never auto-starts when storage is blocked', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(() => markTourSeen(profileId, broken)).not.toThrow()
    expect(shouldAutoStartTour({ balance: 0, loading: false, profileId, defaultProfile: true, storage: broken })).toBe(false)
  })

  it('does not start on a profile added after the default one', () => {
    expect(shouldAutoStartTour({ balance: 0, loading: false, profileId, defaultProfile: false, storage: memory() })).toBe(false)
  })
})

describe('default profile', () => {
  const manager = { listProfiles: () => [{ identityKey: '02aa' }, { identityKey: '03bb' }] }

  it('is the first listed profile', () => {
    expect(isDefaultProfile('02aa', manager)).toBe(true)
    expect(isDefaultProfile('03bb', manager)).toBe(false)
  })

  it('is the only profile of a wallet without profiles', () => {
    expect(isDefaultProfile('02aa', {})).toBe(true)
    expect(isDefaultProfile('02aa', undefined)).toBe(true)
  })

  it('is unknown without an identity or when profiles cannot be listed', () => {
    expect(isDefaultProfile(null, manager)).toBe(false)
    expect(isDefaultProfile('02aa', { listProfiles: () => { throw new Error('Not authenticated.') } })).toBe(false)
  })
})
