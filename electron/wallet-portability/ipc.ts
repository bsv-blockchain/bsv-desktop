import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { WalletPortabilityService } from './service.js'
import { newArchiveId } from './repository.js'
import { type ArchiveChain, PortabilityError } from './schema.js'

const string = (value: unknown, max = 4096): string => {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid wallet file request')
  return value
}
const chain = (value: unknown): ArchiveChain => {
  if (value !== 'main' && value !== 'test' && value !== 'ttn') throw new Error('Invalid wallet network')
  return value
}
export function registerWalletPortabilityIpc(getWindow: () => BrowserWindow | null, getService: () => Promise<WalletPortabilityService>): void {
  const trusted = (event: IpcMainInvokeEvent) => {
    const window = getWindow()
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Wallet file operations require the wallet window')
    return window
  }
  ipcMain.handle('wallet-data:call', async (event, action: string, raw: unknown) => {
    const window = trusted(event)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid wallet file request')
    const data = raw as Record<string, any>, service = await getService(), repo = service.repository
    const report = (message: string) => { if (!window.isDestroyed()) window.webContents.send('wallet-data:progress', message) }
    const saveDestination = async (name: string) => {
      const selection = await dialog.showSaveDialog(window, { title: 'Save encrypted wallet data', defaultPath: name, filters: [{ name: 'Encrypted wallet data', extensions: ['brc39'] }] })
      return selection.canceled ? undefined : selection.filePath
    }
    switch (action) {
      case 'list': return await repo.list()
      case 'cancel': repo.cancel(); return
      case 'binding': return service.host.bindings.get(string(data.identity, 66), chain(data.chain))
      case 'preference': {
        const identity = string(data.identity, 66), network = chain(data.chain)
        const bindings = service.host.bindings, binding = bindings.get(identity, network)
        if (typeof data.preferLocal !== 'boolean') throw new Error('Invalid storage preference')
        if (binding) bindings.set(identity, network, { ...binding, preferLocal: data.preferLocal })
        return
      }
      case 'import': {
        const password = string(data.password)
        const selection = await dialog.showOpenDialog(window, { title: 'Open wallet data file', properties: ['openFile'], filters: [{ name: 'Wallet data', extensions: ['brc39', 'brc38', 'json'] }, { name: 'All files', extensions: ['*'] }] })
        if (selection.canceled || selection.filePaths.length !== 1) return
        return await repo.import(selection.filePaths[0], password, report)
      }
      case 'retry': {
        const job = await repo.get(string(data.id, 32))
        return await repo.import(repo.originalPath(job.id), string(data.password), report, job.fileName)
      }
      case 'restore': return await repo.restore(string(data.id, 32), report)
      case 'exportImport': {
        const id = string(data.id, 32), password = string(data.password), destination = await saveDestination('wallet-recovery.brc39')
        if (destination) await repo.exportImport(id, password, destination, report)
        return Boolean(destination)
      }
      case 'exportBefore': {
        const job = await repo.get(string(data.id, 32)), password = string(data.password)
        if (!job.beforeId || !job.beforeDigest) throw new PortabilityError('storage', 'no before-merge recovery point')
        const destination = await saveDestination('wallet-before-merge.brc39')
        if (destination) await service.exportSnapshot(job.beforeId, job.beforeDigest, password, destination, report)
        return Boolean(destination)
      }
      case 'saveOriginal': {
        const job = await repo.get(string(data.id, 32))
        if (job.format !== 'brc39') {
          const answer = await dialog.showMessageBox(window, { type: 'warning', message: 'This file may be unencrypted', detail: 'Anyone with this file may read its wallet history and data. Save it only to a location you trust.', buttons: ['Cancel', 'Save original'], defaultId: 0, cancelId: 0 })
          if (answer.response !== 1) return false
        }
        const result = await dialog.showSaveDialog(window, { title: 'Save original wallet file', defaultPath: path.basename(job.fileName) })
        if (result.canceled || !result.filePath) return false
        const temporary = `${result.filePath}.${newArchiveId()}.partial`
        try { fs.copyFileSync(repo.originalPath(job.id), temporary, fs.constants.COPYFILE_EXCL); fs.chmodSync(temporary, 0o600); fs.renameSync(temporary, result.filePath) }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
        return true
      }
      case 'createCopy': return await service.createCopy(string(data.identity, 66), chain(data.chain), string(data.activeStore, 64))
      case 'copyCall': return await service.copyCall(string(data.id, 32), string(data.method, 64), data.args)
      case 'closeCopy': return await service.closeCopy(string(data.id, 32))
      case 'capture': return await service.capture(string(data.identity, 66), chain(data.chain), data.copyId === undefined ? undefined : string(data.copyId, 32), report)
      case 'exportSnapshot': {
        const id = string(data.id, 32), digest = string(data.digest, 64), password = string(data.password)
        const destination = await saveDestination('wallet-data.brc39')
        if (destination) await service.exportSnapshot(id, digest, password, destination, report)
        return Boolean(destination)
      }
      case 'prepareMerge': return await service.prepareMerge(string(data.id, 32), string(data.identity, 66), chain(data.chain), string(data.target, 64), data.before === undefined ? undefined : { id: string(data.before.id, 32), digest: string(data.before.digest, 64) }, report)
      case 'finishMerge': return await service.finishMerge(string(data.id, 32), string(data.target, 64))
      case 'activate': return await service.activate(string(data.id, 32), chain(data.chain), data.identity === undefined ? undefined : string(data.identity, 66), report)
      default: throw new Error('Unsupported wallet file operation')
    }
  })
}
