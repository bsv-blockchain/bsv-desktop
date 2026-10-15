import { describe, it, expect } from 'vitest'
import { backupMarkerKey, markWalletBackedUp, getWalletBackupTime } from '../src/lib/services/walletCheck/backupMarker'

function memory() {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, map }
}

describe('backup marker', () => {
  it('keys by base64 profile id', () => {
    expect(backupMarkerKey([1, 2, 3])).toBe('walletBackup_AQID')
  })
  it('round-trips an ISO timestamp per profile', () => {
    const s = memory()
    markWalletBackedUp([1, 2, 3], s, new Date('2026-10-10T12:00:00Z'))
    expect(getWalletBackupTime([1, 2, 3], s)).toBe('2026-10-10T12:00:00.000Z')
    expect(getWalletBackupTime([9], s)).toBeNull()
  })
  it('never throws when storage is unavailable', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(() => markWalletBackedUp([1], broken)).not.toThrow()
    expect(getWalletBackupTime([1], broken)).toBeNull()
  })
})
