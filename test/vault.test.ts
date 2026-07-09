import { describe, it, expect, beforeEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

const TMP = path.join(os.tmpdir(), `vault-test-${process.pid}-${Date.now()}`)

vi.mock('electron', () => ({
  app: { getPath: () => TMP },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (s: string) => Buffer.from('ENC:' + s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^ENC:/, ''),
  },
  systemPreferences: {
    canPromptTouchID: () => false,
    promptTouchID: async () => {},
  },
}))

let vault: typeof import('../electron/vault')

describe('vault', () => {
  beforeEach(async () => {
    fs.rmSync(TMP, { recursive: true, force: true })
    fs.mkdirSync(TMP, { recursive: true })
    vi.resetModules()
    vault = await import('../electron/vault')
    vault._resetForTests()
  })

  it('enrolls, locks secrets until unlock, then exposes them', async () => {
    const r = vault.enroll({
      passphrase: 'test-passphrase-ok',
      enableBiometrics: false,
      initialSecrets: { snap: 'SNAPDATA', primaryKeyHex: 'aabb' },
    })
    expect(r.ok).toBe(true)
    expect(vault.getSecret('snap')).toBe('SNAPDATA')

    const raw = fs.readFileSync(path.join(TMP, 'vault.dat'), 'utf8')
    expect(raw).not.toContain('SNAPDATA')
    expect(raw).not.toContain('aabb')

    vault.lock()
    expect(vault.status().locked).toBe(true)
    expect(vault.getAll()).toEqual({})
    expect(vault.getSecret('snap')).toBeNull()

    const unlock = await vault.unlockWithPassphrase('test-passphrase-ok')
    expect(unlock.ok).toBe(true)
    expect(vault.getSecret('snap')).toBe('SNAPDATA')
    expect(vault.getSecret('primaryKeyHex')).toBe('aabb')
  })

  it('rejects wrong passphrase', async () => {
    vault.enroll({ passphrase: 'test-passphrase-ok', enableBiometrics: false })
    vault.lock()
    const bad = await vault.unlockWithPassphrase('nope-nope-nope')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toMatch(/Incorrect/i)
  })

  it('setSecret re-seals while unlocked', () => {
    vault.enroll({ passphrase: 'test-passphrase-ok', enableBiometrics: false })
    vault.setSecret('mnemonic12', 'word '.repeat(12).trim())
    vault.lock()
  })

  it('setSecret throws when locked', () => {
    vault.enroll({ passphrase: 'test-passphrase-ok', enableBiometrics: false })
    vault.lock()
    expect(() => vault.setSecret('snap', 'x')).toThrow(/VAULT_LOCKED/)
  })

  it('rejects disallowed names', () => {
    vault.enroll({ passphrase: 'test-passphrase-ok', enableBiometrics: false })
    expect(() => vault.setSecret('evil', 'x')).toThrow(/not permitted/)
  })

  it('requires min passphrase length', () => {
    const r = vault.enroll({ passphrase: 'short', enableBiometrics: false })
    expect(r.ok).toBe(false)
  })

  it('migrateFromSecretMap creates vault and removes secrets.dat', () => {
    fs.writeFileSync(path.join(TMP, 'secrets.dat'), JSON.stringify({ version: 1, entries: {} }))
    expect(vault.needsMigration()).toBe(true)
    const r = vault.migrateFromSecretMap(
      { snap: 'from-v1' },
      { passphrase: 'test-passphrase-ok', enableBiometrics: false }
    )
    expect(r.ok).toBe(true)
    expect(fs.existsSync(path.join(TMP, 'secrets.dat'))).toBe(false)
    expect(vault.getSecret('snap')).toBe('from-v1')
    expect(vault.needsMigration()).toBe(false)
  })

  it('status reports methods and migration flag', () => {
    expect(vault.status().hasVault).toBe(false)
    vault.enroll({ passphrase: 'test-passphrase-ok', enableBiometrics: false })
    const s = vault.status()
    expect(s.hasVault).toBe(true)
    expect(s.methods).toContain('passphrase')
    expect(s.locked).toBe(false)
  })
})
