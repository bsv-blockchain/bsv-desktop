import { describe, it, expect, beforeEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

// Per-run temp userData dir
const TMP = path.join(os.tmpdir(), `secretstore-test-${process.pid}-${Date.now()}`)

let encAvailable = true
let backend = 'keychain'

vi.mock('electron', () => ({
  app: { getPath: () => TMP },
  safeStorage: {
    isEncryptionAvailable: () => encAvailable,
    getSelectedStorageBackend: () => backend,
    // reversible stand-in for real OS crypto
    encryptString: (s: string) => Buffer.from('ENC:' + s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^ENC:/, ''),
  },
}))

let store: typeof import('../electron/secretStore')

describe('secretStore', () => {
  beforeEach(async () => {
    encAvailable = true
    backend = 'keychain'
    fs.rmSync(TMP, { recursive: true, force: true })
    fs.mkdirSync(TMP, { recursive: true })
    vi.resetModules()
    store = await import('../electron/secretStore')
  })

  it('round-trips an encrypted secret and persists ciphertext (not plaintext)', () => {
    store.setSecret('snap', 'hello-snapshot')
    expect(store.getSecret('snap')).toBe('hello-snapshot')
    const raw = fs.readFileSync(path.join(TMP, 'secrets.dat'), 'utf8')
    expect(raw).not.toContain('hello-snapshot')
    const parsed = JSON.parse(raw)
    expect(parsed.entries.snap.enc).toBe(true)
  })

  it('falls back to plaintext when encryption unavailable', () => {
    encAvailable = false
    store.setSecret('snap', 'plain-value')
    expect(store.getSecret('snap')).toBe('plain-value')
    const parsed = JSON.parse(fs.readFileSync(path.join(TMP, 'secrets.dat'), 'utf8'))
    expect(parsed.entries.snap.enc).toBe(false)
  })

  it('treats basic_text backend as unencrypted fallback', () => {
    backend = 'basic_text'
    store.setSecret('snap', 'v')
    const parsed = JSON.parse(fs.readFileSync(path.join(TMP, 'secrets.dat'), 'utf8'))
    expect(parsed.entries.snap.enc).toBe(false)
  })

  it('reads each entry per its own enc flag', () => {
    store.setSecret('snap', 'encrypted-one')
    encAvailable = false
    store.setSecret('primaryKeyHex', 'plain-one')
    encAvailable = true
    const all = store.getAll()
    expect(all.snap).toBe('encrypted-one')
    expect(all.primaryKeyHex).toBe('plain-one')
  })

  it('rejects names not on the allow-list', () => {
    expect(() => store.setSecret('evil', 'x')).toThrow(/not permitted/)
    expect(() => store.getSecret('evil')).toThrow(/not permitted/)
  })

  it('getAll on missing file returns empty object', () => {
    expect(store.getAll()).toEqual({})
  })

  it('deleteSecret removes only that entry', () => {
    store.setSecret('snap', 'a')
    store.setSecret('mnemonic12', 'b')
    store.deleteSecret('snap')
    expect(store.getSecret('snap')).toBeNull()
    expect(store.getSecret('mnemonic12')).toBe('b')
  })
})
