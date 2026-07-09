/**
 * Biometric / passphrase vault for wallet secrets.
 *
 * Secrets on disk live only inside AES-GCM ciphertext under a random DEK.
 * The DEK is wrapped by a passphrase (always) and optionally by a biometric wrap.
 * In-memory DEK + plaintext secrets exist only after unlock until lock/exit.
 */
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import {
  AAD,
  aesGcmDecrypt,
  aesGcmEncrypt,
  b64,
  defaultKdf,
  randomDek,
  ScryptKdf,
  unwrapDekWithPassphrase,
  wrapDekWithPassphrase,
} from './vaultCrypto.js'
import * as biometric from './biometric.js'
import { BootConfig, UnlockMethod, updateBootConfig, getBootConfig, clearBootConfig } from './bootConfig.js'

export const ALLOWED: ReadonlySet<string> = new Set(['snap', 'primaryKeyHex', 'mnemonic12'])

export type SecretMap = Record<string, string>

interface VaultFile {
  version: 2
  kdf: ScryptKdf
  wraps: {
    se?: { platform: string; label: string; blob: string }
    passphrase: { blob: string }
  }
  nonce: string
  ciphertext: string
  aad: string
}

export interface VaultStatus {
  locked: boolean
  hasVault: boolean
  methods: UnlockMethod[]
  biometricsAvailable: boolean
  needsMigration: boolean
}

export type VaultResult = { ok: true } | { ok: false; error: string }

const RATE_LIMIT_BASE_MS = 500
const RATE_LIMIT_MAX_MS = 15_000

let dek: Buffer | null = null
let secrets: SecretMap = {}
let unlocked = false
let failCount = 0
let nextAttemptAt = 0

function assertAllowed(name: string): void {
  if (!ALLOWED.has(name)) throw new Error(`vault: name not permitted: ${name}`)
}

function vaultPath(): string {
  return path.join(app.getPath('userData'), 'vault.dat')
}

function secretsDatPath(): string {
  return path.join(app.getPath('userData'), 'secrets.dat')
}

function readVaultFile(): VaultFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(vaultPath(), 'utf8'))
    if (parsed && parsed.version === 2 && parsed.wraps?.passphrase) return parsed as VaultFile
  } catch {
    // missing/corrupt
  }
  return null
}

function writeVaultFile(file: VaultFile): void {
  const tmp = vaultPath() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 })
  fs.renameSync(tmp, vaultPath())
}

function sealWithDek(currentDek: Buffer, map: SecretMap): Pick<VaultFile, 'nonce' | 'ciphertext' | 'aad'> {
  const payload: SecretMap = {}
  for (const name of ALLOWED) {
    if (map[name] != null) payload[name] = map[name]
  }
  const plain = Buffer.from(JSON.stringify(payload), 'utf8')
  const { nonce, ciphertext } = aesGcmEncrypt(currentDek, plain, AAD)
  return { nonce, ciphertext, aad: 'bsv-desktop-vault-v2' }
}

function openWithDek(currentDek: Buffer, file: VaultFile): SecretMap {
  const plain = aesGcmDecrypt(currentDek, file.nonce, file.ciphertext, AAD)
  const obj = JSON.parse(plain.toString('utf8')) as SecretMap
  const out: SecretMap = {}
  for (const name of Object.keys(obj)) {
    if (ALLOWED.has(name) && typeof obj[name] === 'string') out[name] = obj[name]
  }
  return out
}

function persistUnlocked(): void {
  if (!unlocked || !dek) throw new Error('VAULT_LOCKED')
  const file = readVaultFile()
  if (!file) throw new Error('vault file missing')
  const sealed = sealWithDek(dek, secrets)
  writeVaultFile({ ...file, ...sealed })
}

function checkRateLimit(): string | null {
  const now = Date.now()
  if (now < nextAttemptAt) {
    const wait = Math.ceil((nextAttemptAt - now) / 1000)
    return `Too many attempts. Try again in ${wait}s.`
  }
  return null
}

function recordFailure(): void {
  failCount += 1
  const delay = Math.min(RATE_LIMIT_MAX_MS, RATE_LIMIT_BASE_MS * 2 ** Math.min(failCount - 1, 5))
  nextAttemptAt = Date.now() + delay
}

function recordSuccess(): void {
  failCount = 0
  nextAttemptAt = 0
}

function setUnlocked(currentDek: Buffer, map: SecretMap): void {
  dek = currentDek
  secrets = { ...map }
  unlocked = true
  recordSuccess()
}

export function isUnlocked(): boolean {
  return unlocked
}

export function hasVaultFile(): boolean {
  return readVaultFile() != null
}

export function needsMigration(): boolean {
  return !hasVaultFile() && fs.existsSync(secretsDatPath())
}

export function status(): VaultStatus {
  const file = readVaultFile()
  const methods: UnlockMethod[] = []
  if (file) {
    methods.push('passphrase')
    if (file.wraps.se) methods.push('se')
  }
  return {
    locked: file != null && !unlocked,
    hasVault: file != null,
    methods,
    biometricsAvailable: biometric.biometricsAvailable(),
    needsMigration: needsMigration(),
  }
}

export function enroll(options: {
  passphrase: string
  enableBiometrics: boolean
  initialSecrets?: SecretMap
}): VaultResult {
  if (!options.passphrase || options.passphrase.length < 8) {
    return { ok: false, error: 'Passphrase must be at least 8 characters.' }
  }

  const map: SecretMap = {}
  if (options.initialSecrets) {
    for (const [k, v] of Object.entries(options.initialSecrets)) {
      if (ALLOWED.has(k) && typeof v === 'string') map[k] = v
    }
  }

  const currentDek = randomDek()
  const kdf = defaultKdf()
  const passphraseBlob = wrapDekWithPassphrase(options.passphrase, currentDek, kdf)
  const wraps: VaultFile['wraps'] = { passphrase: { blob: passphraseBlob } }

  if (options.enableBiometrics && biometric.biometricsAvailable()) {
    wraps.se = biometric.createSeWrap(currentDek)
  }

  const sealed = sealWithDek(currentDek, map)
  writeVaultFile({
    version: 2,
    kdf,
    wraps,
    ...sealed,
  })

  const unlockMethods: UnlockMethod[] = ['passphrase']
  if (wraps.se) unlockMethods.push('se')
  updateBootConfig({ hasVault: true, unlockMethods })

  setUnlocked(currentDek, map)
  return { ok: true }
}

export async function unlockWithPassphrase(passphrase: string): Promise<VaultResult> {
  const limited = checkRateLimit()
  if (limited) return { ok: false, error: limited }

  const file = readVaultFile()
  if (!file) return { ok: false, error: 'No vault found.' }

  try {
    const currentDek = unwrapDekWithPassphrase(passphrase, file.wraps.passphrase.blob, file.kdf)
    const map = openWithDek(currentDek, file)
    setUnlocked(currentDek, map)
    return { ok: true }
  } catch {
    recordFailure()
    return { ok: false, error: 'Incorrect passphrase.' }
  }
}

export async function unlockWithBiometrics(): Promise<VaultResult> {
  const limited = checkRateLimit()
  if (limited) return { ok: false, error: limited }

  const file = readVaultFile()
  if (!file) return { ok: false, error: 'No vault found.' }
  if (!file.wraps.se) return { ok: false, error: 'Biometric unlock is not enrolled.' }

  const ok = await biometric.promptBiometrics('Unlock BSV Desktop wallet')
  if (!ok) {
    recordFailure()
    return { ok: false, error: 'Biometric authentication failed or was cancelled.' }
  }

  const currentDek = biometric.unwrapSeWrap(file.wraps.se)
  if (!currentDek) {
    recordFailure()
    return { ok: false, error: 'Biometric key unavailable. Use your unlock passphrase.' }
  }

  try {
    const map = openWithDek(currentDek, file)
    setUnlocked(currentDek, map)
    return { ok: true }
  } catch {
    recordFailure()
    return { ok: false, error: 'Failed to open vault with biometrics.' }
  }
}

export function lock(): void {
  if (dek) dek.fill(0)
  dek = null
  secrets = {}
  unlocked = false
}

export function getSecret(name: string): string | null {
  assertAllowed(name)
  if (!unlocked) return null
  return secrets[name] ?? null
}

export function getAll(): Record<string, string> {
  if (!unlocked) return {}
  const out: Record<string, string> = {}
  for (const name of ALLOWED) {
    if (secrets[name] != null) out[name] = secrets[name]
  }
  return out
}

export function setSecret(name: string, value: string): void {
  assertAllowed(name)
  if (!unlocked || !dek) throw new Error('VAULT_LOCKED')
  secrets[name] = value
  persistUnlocked()
}

export function deleteSecret(name: string): void {
  assertAllowed(name)
  if (!unlocked || !dek) throw new Error('VAULT_LOCKED')
  delete secrets[name]
  persistUnlocked()
}

/** Wipe vault file, bio key, boot vault flags, and memory. */
export function destroyVault(): void {
  lock()
  try {
    fs.unlinkSync(vaultPath())
  } catch {
    // ignore
  }
  biometric.deleteBioKey()
  const boot = getBootConfig()
  if (boot) {
    updateBootConfig({ hasVault: false, unlockMethods: [] })
  } else {
    clearBootConfig()
  }
}

/**
 * Migrate v1 secrets.dat into a new vault. Caller supplies passphrase and
 * already-decrypted secret map from secretStore.getAll().
 */
export function migrateFromSecretMap(
  map: SecretMap,
  options: { passphrase: string; enableBiometrics: boolean }
): VaultResult {
  const result = enroll({
    passphrase: options.passphrase,
    enableBiometrics: options.enableBiometrics,
    initialSecrets: map,
  })
  if (!result.ok) return result
  try {
    fs.unlinkSync(secretsDatPath())
  } catch {
    // ignore
  }
  return result
}

/** Test helper: reset module state between tests. */
export function _resetForTests(): void {
  lock()
  failCount = 0
  nextAttemptAt = 0
}

export function getBootConfigPublic(): BootConfig | null {
  return getBootConfig()
}

export function setBootConfigPublic(config: BootConfig): void {
  updateBootConfig(config)
}
