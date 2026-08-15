/**
 * Biometric DEK wrapping.
 *
 * macOS: Electron systemPreferences.promptTouchID for user presence, plus a
 * random bioKey stored via safeStorage (machine-bound). Offline theft of
 * vault.dat alone is insufficient; unwrap still requires this process to
 * successfully complete biometrics (and the OS-sealed bio key file).
 *
 * Windows / Linux: biometrics unavailable in v1 (passphrase-only).
 *
 * Honest limit: this is not a Secure Enclave non-extractable private key.
 * It is a biometric presence gate + OS keychain-sealed bio key. True SE
 * non-extractability can replace BioKeyStore later without changing vault format.
 */
import { app, safeStorage, systemPreferences } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomDek, wrapKey, unwrapKey, b64, fromB64 } from './vaultCrypto.js'

const BIO_LABEL = 'bsv-desktop-vault-dek'
const BIO_AAD_NOTE = 'bio-key'

export interface SeWrapMeta {
  platform: string
  label: string
  blob: string
}

function bioKeyPath(): string {
  return path.join(app.getPath('userData'), 'vault-bio.dat')
}

function encAvailable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    const getBackend = (safeStorage as any).getSelectedStorageBackend
    if (typeof getBackend === 'function' && getBackend.call(safeStorage) === 'basic_text') return false
    return true
  } catch {
    return false
  }
}

function storeBioKey(bioKey: Buffer): void {
  const payload = encAvailable()
    ? { enc: true as const, data: safeStorage.encryptString(b64(bioKey)).toString('base64') }
    : { enc: false as const, data: b64(bioKey) }
  const tmp = bioKeyPath() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 })
  fs.renameSync(tmp, bioKeyPath())
}

function loadBioKey(): Buffer | null {
  try {
    const raw = JSON.parse(fs.readFileSync(bioKeyPath(), 'utf8')) as { enc: boolean; data: string }
    if (raw.enc) {
      return fromB64(safeStorage.decryptString(Buffer.from(raw.data, 'base64')))
    }
    return fromB64(raw.data)
  } catch {
    return null
  }
}

export function deleteBioKey(): void {
  try {
    fs.unlinkSync(bioKeyPath())
  } catch {
    // ignore
  }
}

/** True when this process can offer a biometric unlock path. */
export function biometricsAvailable(): boolean {
  if (process.platform === 'darwin') {
    try {
      return typeof systemPreferences.canPromptTouchID === 'function' && systemPreferences.canPromptTouchID()
    } catch {
      return false
    }
  }
  // Windows Hello not wired in v1
  return false
}

export async function promptBiometrics(reason = 'Unlock BSV Desktop wallet'): Promise<boolean> {
  if (process.platform === 'darwin') {
    try {
      if (!systemPreferences.canPromptTouchID()) return false
      await systemPreferences.promptTouchID(reason)
      return true
    } catch {
      return false
    }
  }
  return false
}

/** Create SE wrap metadata + persist bioKey. Returns wrap for vault.dat. */
export function createSeWrap(dek: Buffer): SeWrapMeta {
  const bioKey = randomDek()
  const blob = wrapKey(bioKey, dek)
  storeBioKey(bioKey)
  return {
    platform: process.platform,
    label: BIO_LABEL,
    blob,
  }
}

/**
 * After successful biometric prompt, unwrap DEK from se wrap.
 * Returns null if bio key missing or unwrap fails.
 */
export function unwrapSeWrap(se: SeWrapMeta): Buffer | null {
  const bioKey = loadBioKey()
  if (!bioKey) return null
  try {
    return unwrapKey(bioKey, se.blob)
  } catch {
    return null
  }
}

// silence unused for future AAD tagging
void BIO_AAD_NOTE
