/**
 * Simulates the full IPC round-trip as it happens in the real app.
 *
 * Code path modeled:
 *   StorageElectronIPC.callMethod() (src/lib/StorageElectronIPC.ts:131-146)
 *     -> ipcRenderer.invoke() serialization (electron/preload.ts:42-43)
 *     -> ipcMain.handle('storage:call-method') (electron/main.ts:355-364)
 *     -> StorageManager.callStorageMethod() (electron/storage.ts:338-362)
 *     -> JSON serialize result back
 *
 * The only overhead NOT captured is the actual Electron IPC transport (~0.1ms/call).
 */

import type { StorageKnex } from '@bsv/wallet-toolbox'

export class IPCSimulator {
  private storage: StorageKnex

  constructor(storage: StorageKnex) {
    this.storage = storage
  }

  /**
   * Simulate the full renderer -> main -> storage -> main -> renderer path.
   */
  async callMethod(method: string, args: any[]): Promise<any> {
    // Step 1: Simulate renderer->main serialization (Electron structured clone ≈ JSON)
    const serializedArgs = JSON.parse(JSON.stringify(args))

    // Step 2: Simulate StorageManager.callStorageMethod dispatch (electron/storage.ts:338-362)
    const storageAny = this.storage as any
    if (typeof storageAny[method] !== 'function') {
      throw new Error(`Method ${method} does not exist on StorageKnex`)
    }
    const result = await storageAny[method](...serializedArgs)

    // Step 3: Simulate main->renderer result serialization
    const serializedResult = JSON.parse(
      JSON.stringify({ success: true, result })
    )

    return serializedResult.result
  }
}
