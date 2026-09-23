import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: any[]) => Promise<unknown>>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) => handlers.set(channel, handler) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() }
}))

const { registerWalletPortabilityIpc } = await import('../electron/wallet-portability/ipc')

describe('wallet data IPC boundary', () => {
  const mainFrame = {}
  const webContents = { mainFrame, send: vi.fn() }
  const window = { webContents, isDestroyed: () => false }
  const jobs = [{ id: 'a'.repeat(32) }]
  const getService = vi.fn(async () => ({ repository: { list: async () => jobs } }) as any)

  beforeEach(() => {
    handlers.clear()
    getService.mockClear()
    registerWalletPortabilityIpc(() => window as any, getService)
  })

  const call = (event: unknown, action = 'list', data: unknown = {}) => handlers.get('wallet-data:call')!(event, action, data)

  it('serves the wallet window main frame', async () => {
    await expect(call({ sender: webContents, senderFrame: mainFrame })).resolves.toEqual(jobs)
  })

  it.each([
    ['another webContents', { sender: { mainFrame }, senderFrame: mainFrame }],
    ['a subframe of the wallet window', { sender: webContents, senderFrame: {} }]
  ])('rejects %s before touching wallet files', async (_case, event) => {
    await expect(call(event)).rejects.toThrow('require the wallet window')
    expect(getService).not.toHaveBeenCalled()
  })

  it('rejects requests when the wallet window is gone', async () => {
    handlers.clear()
    registerWalletPortabilityIpc(() => null, getService)
    await expect(call({ sender: webContents, senderFrame: mainFrame })).rejects.toThrow('require the wallet window')
  })

  it('rejects malformed payloads and unknown actions', async () => {
    const event = { sender: webContents, senderFrame: mainFrame }
    await expect(call(event, 'list', null)).rejects.toThrow('Invalid wallet file request')
    await expect(call(event, 'list', [])).rejects.toThrow('Invalid wallet file request')
    await expect(call(event, 'deleteEverything')).rejects.toThrow('Unsupported wallet file operation')
  })
})
