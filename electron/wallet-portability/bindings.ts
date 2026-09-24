import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import type { ArchiveChain } from './schema.js'

export const walletDataDirectory = () => path.join(os.homedir(), '.bsv-desktop', 'wallet-portability-v1')
export interface WalletDataBinding { id: string; storageIdentityKey: string; preferLocal: boolean; activatedAt: string }
export function walletStorageKey(identity: string, chain: ArchiveChain): string {
  if (!/^(02|03)[a-f0-9]{64}$/.test(identity) || !['main', 'test', 'ttn'].includes(chain)) throw new Error('Invalid wallet identity or network')
  return `${identity}-${chain}`
}
export class WalletDataBindings {
  constructor(readonly directory = walletDataDirectory()) {}
  private all(): Record<string, WalletDataBinding> {
    const file = path.join(this.directory, 'bindings.json')
    if (!fs.existsSync(file)) return {}
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved wallet selection requires recovery')
    return value
  }
  get(identity: string, chain: ArchiveChain): WalletDataBinding | undefined {
    const value = this.all()[walletStorageKey(identity, chain)]
    if (!value) return undefined
    if (!/^[a-f0-9]{32}$/.test(value.id) || !/^[a-f0-9]{64}$/.test(value.storageIdentityKey) || typeof value.preferLocal !== 'boolean') throw new Error('Saved wallet selection requires recovery')
    if (!fs.existsSync(path.join(this.directory, `${value.id}.db`))) throw new Error('Selected recovery database is missing; earlier storage is retained')
    return value
  }
  set(identity: string, chain: ArchiveChain, binding: WalletDataBinding): void {
    const key = walletStorageKey(identity, chain), values = this.all()
    if (!/^[a-f0-9]{32}$/.test(binding.id) || !/^[a-f0-9]{64}$/.test(binding.storageIdentityKey)) throw new Error('Invalid recovery binding')
    values[key] = binding
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const temporary = path.join(this.directory, `bindings-${randomBytes(16).toString('hex')}.partial`)
    const fd = fs.openSync(temporary, 'wx', 0o600)
    try { fs.writeFileSync(fd, JSON.stringify(values)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temporary, path.join(this.directory, 'bindings.json'))
    // Persist the directory entry before reporting activation complete.
    if (process.platform !== 'win32') {
      const directory = fs.openSync(this.directory, 'r')
      try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
    }
  }
  databasePath(identity: string, chain: ArchiveChain): string {
    const key = walletStorageKey(identity, chain), binding = this.get(identity, chain)
    return binding ? path.join(this.directory, `${binding.id}.db`) : path.join(os.homedir(), '.bsv-desktop', `wallet-${key}.db`)
  }
}

export function assertRecoveryBinding(binding: WalletDataBinding, chain: ArchiveChain, settings: any, user: any, identity: string): void {
  if (!settings || settings.chain !== chain || settings.storageIdentityKey !== binding.storageIdentityKey ||
      !user || user.identityKey !== identity) throw new Error('Selected recovery database does not match the saved wallet identity, network or storage key')
}
