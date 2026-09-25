import type { sdk } from '@bsv/wallet-toolbox-client'
import { WalletDataStorageManager } from './WalletDataStorageManager'
export const walletDataCall = <T = any>(action: string, data: Record<string, unknown> = {}): Promise<T> => window.electronAPI.walletData.call(action, data)
const stopped = (signal: AbortSignal) => { if (signal.aborted) throw new Error('Stopped safely. Original files and recovery copies are retained.') }
const provider = (id: string, signal: AbortSignal) => {
  const invoke = (method: string, ...args: any[]) => { stopped(signal); return walletDataCall('copyCall', { id, method, args }) }
  return {
    makeAvailable: () => invoke('makeAvailable'),
    getSyncChunk: (args: any) => invoke('getSyncChunk', args),
    findOrInsertUser: (identity: string) => invoke('findOrInsertUser', identity),
    findOrInsertSyncStateAuth: (...args: any[]) => invoke('findOrInsertSyncStateAuth', ...args),
    processSyncChunk: (...args: any[]) => invoke('processSyncChunk', ...args)
  }
}
export class WalletDataSession {
  private controller = new AbortController()
  private operation?: AbortController
  constructor(readonly identityKey: string, readonly chain: 'main' | 'test' | 'ttn', readonly manager: WalletDataStorageManager, readonly local: boolean) {}
  cancel(): void { this.operation?.abort(); void walletDataCall('cancel').catch(() => {}) }
  async close(): Promise<void> { this.controller.abort(); this.cancel(); await this.manager.closeForRestore(async () => {}) }
  private async run<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.operation || this.controller.signal.aborted) throw new Error('Wallet is busy or has changed. Reopen the file screen.')
    const operation = new AbortController(); this.operation = operation
    const cancel = () => operation.abort()
    this.controller.signal.addEventListener('abort', cancel, { once: true })
    try { return await action(operation.signal) }
    finally { this.controller.signal.removeEventListener('abort', cancel); this.operation = undefined }
  }
  private async capture(active: sdk.WalletStorageSync, signal: AbortSignal): Promise<{ id: string; digest: string }> {
    let copyId: string | undefined
    try {
      if (!this.local) {
        copyId = await walletDataCall('createCopy', { identity: this.identityKey, chain: this.chain, activeStore: this.manager.getActiveStore() })
        const writer = provider(copyId, signal)
        const { user } = await writer.findOrInsertUser(this.identityKey)
        const getChunk = active.getSyncChunk.bind(active)
        active.getSyncChunk = async args => { stopped(signal); return await getChunk({ ...args, maxItems: Math.min(250, args.maxItems), maxRoughSize: Math.min(2 * 1024 * 1024, args.maxRoughSize) }) }
        try { await this.manager.syncToWriter({ identityKey: this.identityKey, userId: user.userId, isActive: false }, writer as any, active) }
        finally { active.getSyncChunk = getChunk }
      }
      stopped(signal)
      return await walletDataCall('capture', { identity: this.identityKey, chain: this.chain, copyId })
    } finally { if (copyId) await walletDataCall('closeCopy', { id: copyId }) }
  }
  async export(password: string): Promise<boolean> {
    return await this.run(async signal => {
      const snapshot = await this.manager.runAsSync(active => this.capture(active, signal))
      stopped(signal)
      return await walletDataCall('exportSnapshot', { ...snapshot, password })
    })
  }
  async merge(id: string): Promise<void> {
    await this.run(signal => this.manager.runAsSync(async active => {
      const target = this.manager.getActiveStore()
      const jobs = await walletDataCall<any[]>('list'), job = jobs.find(row => row.id === id)
      if (job?.summary?.identityKey !== this.identityKey || job.summary.chain !== this.chain) throw new Error('File belongs to a different wallet or network')
      const before = job.state === 'merging' ? undefined : await this.capture(active, signal)
      stopped(signal)
      const prepared = await walletDataCall('prepareMerge', { id, identity: this.identityKey, chain: this.chain, target, before })
      try {
        stopped(signal)
        await this.manager.syncFromReader(this.identityKey, provider(prepared.reader, signal), active)
        stopped(signal)
        await walletDataCall('finishMerge', { id, target })
      } finally { await walletDataCall('closeCopy', { id: prepared.reader }) }
    }))
  }
  async activate(id: string): Promise<void> {
    await this.run(async signal => {
      stopped(signal)
      await this.manager.closeForRestore(async () => {
        await walletDataCall('activate', { id, identity: this.identityKey, chain: this.chain })
      })
      this.controller.abort()
    })
  }
}
