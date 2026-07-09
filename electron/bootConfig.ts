/**
 * Non-secret boot configuration readable before vault unlock.
 */
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export type UnlockMethod = 'se' | 'passphrase'

export interface BootConfig {
  version: 1
  hasVault: boolean
  unlockMethods: UnlockMethod[]
  network?: string
  loginType?: string
  wabUrl?: string
  storageUrl?: string
  messageBoxUrl?: string
  authMethod?: string
  useRemoteStorage?: boolean
  useMessageBox?: boolean
  backupStorageUrls?: string[]
}

function filePath(): string {
  return path.join(app.getPath('userData'), 'boot-config.json')
}

export function getBootConfig(): BootConfig | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.version === 1) {
      return parsed as BootConfig
    }
  } catch {
    // missing/corrupt
  }
  return null
}

export function setBootConfig(config: BootConfig): void {
  const tmp = filePath() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, filePath())
}

export function updateBootConfig(patch: Partial<BootConfig>): BootConfig {
  const current = getBootConfig() || {
    version: 1 as const,
    hasVault: false,
    unlockMethods: [] as UnlockMethod[],
  }
  const next: BootConfig = {
    ...current,
    ...patch,
    version: 1,
    hasVault: patch.hasVault ?? current.hasVault,
    unlockMethods: patch.unlockMethods ?? current.unlockMethods ?? [],
  }
  setBootConfig(next)
  return next
}

export function clearBootConfig(): void {
  try {
    fs.unlinkSync(filePath())
  } catch {
    // ignore
  }
}
