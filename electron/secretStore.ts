import { app, safeStorage } from 'electron'
import path from 'path'
import fs from 'fs'

/** Only these secret names may be stored or read. */
const ALLOWED: ReadonlySet<string> = new Set(['snap', 'primaryKeyHex', 'mnemonic12'])

interface Entry { enc: boolean; data: string }
interface SecretFile { version: number; entries: Record<string, Entry> }

function assertAllowed(name: string): void {
  if (!ALLOWED.has(name)) throw new Error(`secretStore: name not permitted: ${name}`)
}

function filePath(): string {
  return path.join(app.getPath('userData'), 'secrets.dat')
}

/** True only when the OS provides real encryption (not Linux basic_text). */
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

function readFile(): SecretFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.entries) return parsed as SecretFile
  } catch {
    // missing or corrupt file -> empty store
  }
  return { version: 1, entries: {} }
}

function writeFile(data: SecretFile): void {
  const tmp = filePath() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
  fs.renameSync(tmp, filePath())
}

let warned = false
function warnFallbackOnce(): void {
  if (warned) return
  warned = true
  console.warn(
    '[secretStore] OS encryption unavailable — wallet secrets stored UNENCRYPTED on disk. ' +
    'Install/enable a keyring (libsecret or kwallet) for at-rest protection.'
  )
}

function decodeEntry(entry: Entry): string {
  return entry.enc
    ? safeStorage.decryptString(Buffer.from(entry.data, 'base64'))
    : Buffer.from(entry.data, 'base64').toString('utf8')
}

export function getSecret(name: string): string | null {
  assertAllowed(name)
  const entry = readFile().entries[name]
  return entry ? decodeEntry(entry) : null
}

export function setSecret(name: string, value: string): void {
  assertAllowed(name)
  const file = readFile()
  if (encAvailable()) {
    file.entries[name] = { enc: true, data: safeStorage.encryptString(value).toString('base64') }
  } else {
    warnFallbackOnce()
    file.entries[name] = { enc: false, data: Buffer.from(value, 'utf8').toString('base64') }
  }
  writeFile(file)
}

export function deleteSecret(name: string): void {
  assertAllowed(name)
  const file = readFile()
  if (file.entries[name]) {
    delete file.entries[name]
    writeFile(file)
  }
}

export function getAll(): Record<string, string> {
  const file = readFile()
  const out: Record<string, string> = {}
  for (const name of Object.keys(file.entries)) {
    if (!ALLOWED.has(name)) continue
    try {
      out[name] = decodeEntry(file.entries[name])
    } catch (err) {
      console.error(`[secretStore] failed to read secret ${name}:`, err)
    }
  }
  return out
}
