import { describe, expect, it } from 'vitest'
import { PrivateKey } from '@bsv/sdk'
import { portableSqlRow } from '../electron/wallet-portability/sqliteArchive'
import { validateRow } from '../electron/wallet-portability/schema'

describe('portableSqlRow date normalisation', () => {
  it('converts integer epoch ms to ISO', () => {
    expect(portableSqlRow('user', { updated_at: 1790288582148 }).updated_at).toBe(new Date(1790288582148).toISOString())
  })
  it('converts SQLite CURRENT_TIMESTAMP text as UTC', () => {
    expect(portableSqlRow('sourceStorage', { created_at: '2026-09-10 22:18:17' }).created_at).toBe('2026-09-10T22:18:17.000Z')
  })
  it('converts SQLite text with milliseconds', () => {
    expect(portableSqlRow('sourceStorage', { created_at: '2026-09-10 22:18:17.123' }).created_at).toBe('2026-09-10T22:18:17.123Z')
  })
  it('converts the when field too', () => {
    expect(portableSqlRow('syncStates', { when: '2026-09-10 22:18:17' }).when).toBe('2026-09-10T22:18:17.000Z')
  })
  it('passes valid ISO through unchanged', () => {
    expect(portableSqlRow('user', { created_at: '2026-09-10T22:18:17.725Z' }).created_at).toBe('2026-09-10T22:18:17.725Z')
  })
  it('converts Date instances', () => {
    expect(portableSqlRow('user', { created_at: new Date('2026-09-10T22:18:17.725Z') }).created_at).toBe('2026-09-10T22:18:17.725Z')
  })
  it('leaves unparseable values for the validator to reject', () => {
    expect(portableSqlRow('user', { created_at: 'yesterday' }).created_at).toBe('yesterday')
  })
  it('does not touch non-date numeric fields', () => {
    expect(portableSqlRow('user', { userId: 1 }).userId).toBe(1)
  })

  it('a user row with mixed encodings validates', () => {
    // Adaptation: '02'+'11'.repeat(32) is not a point on the curve, so use a real key.
    const identityKey = PrivateKey.fromRandom().toPublicKey().toString()
    const row = { userId: 1, identityKey, activeStorage: '02' + '22'.repeat(32), created_at: '2026-09-10T22:18:17.725Z', updated_at: 1790288582148 }
    expect(() => validateRow('user', portableSqlRow('user', row))).not.toThrow()
  })
  it('a settings row with a SQLite timestamp validates as sourceStorage', () => {
    const settings = { storageIdentityKey: '02' + '33'.repeat(32), storageName: 'local', chain: 'main', dbtype: 'SQLite', maxOutputScript: 10000, created_at: '2026-09-10 22:18:17', updated_at: 1790288582148 }
    expect(() => validateRow('sourceStorage', portableSqlRow('sourceStorage', settings))).not.toThrow()
  })
})
