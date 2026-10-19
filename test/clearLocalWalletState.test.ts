import { beforeEach, describe, expect, it, vi } from 'vitest'

const vault = vi.hoisted(() => ({
  endSession: vi.fn(async () => {}),
  clearCache: vi.fn()
}))
vi.mock('../src/lib/services/secrets', () => ({
  getSnapshot: () => 'saved',
  setSnapshot: () => {},
  persistSnapshot: async () => {},
  getKeyHex: () => null,
  getMnemonic: () => null,
  endSession: vault.endSession,
  clearCache: vault.clearCache
}))
vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('../src/onWalletReady', () => ({ clearWalletForHttpRoute: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { WalletService } from '../src/lib/services/WalletService'
import { listKeptDirectPayments } from '../src/lib/pages/Dashboard/Payments/directPayments'

const identity = `02${'12'.repeat(32)}`

// Direct payments this device acknowledged as received but the wallet has not added yet. The
// payer will not resend them and only this device has their derivation, so they outlive a
// logout and a removal (final review D1, Ruling 36). Keyed by identity and network.
const keptPayment = { key: `${'ab'.repeat(32)}:0:cHJl:c3Vm`, payment: { messageId: 'm1', sender: `03${'34'.repeat(32)}`, token: { customInstructions: { derivationPrefix: 'cHJl', derivationSuffix: 'c3Vm' }, transaction: 'AQID', amount: 700, outputIndex: 0 } }, error: 'fetch failed', receivedAt: 1, attempts: 0 }
const keptPayments: Record<string, string> = {
  [`direct-pay-retry-v1:${identity}:main`]: JSON.stringify([keptPayment]),
  [`direct-pay-retry-v1:${identity}:test`]: '[{"key":"k","payment":{"token":{"transaction":"AQ=="}}}]'
}
// What a signed-in device holds: payment state that must outlive a logout,
// and wallet state that must not.
const paymentState: Record<string, string> = {
  [`peerpay-outbox-v1:${identity}:main`]: '[{"id":"out-1"}]',
  [`nearby-payment-v1:${identity}:main`]: '{"id":"near-1"}',
  'direct-pay-seen-v1:abc': '["k1"]',
  ...keptPayments,
  'direct-pay-retry-v2:x': '[]', // kept on logout like all direct-pay state, but not a kept-payment list
  'bsv-desktop-direct-pay-v1': '{"receiveEnabled":true}',
  'bsv-desktop-direct-pay-v2': '{"receiveEnabled":false}',
  [`messagebox-received-v1:${identity}:main`]: '[]'
}
const walletState: Record<string, string> = {
  snap: 'AAAA',
  permissionsConfig: '{}',
  [`brc100_recent_apps_${identity}`]: '[]',
  // Near misses of the preserved prefixes and key.
  'peerpay-outbox-v2:x': '[]',
  'nearby-payment-v2:x': '{}',
  'direct-payments-cache': '{}',
  'bsv-desktop-direct-pay-v10': '{}',
  'messagebox-received-v2:x': '[]'
}

let local: Map<string, string>

function readyService() {
  const service = new WalletService()
  const state = service as any
  state._lifecycle = 'ready'
  state._wallet = { getPublicKey: vi.fn(async () => ({ publicKey: identity })) }
  state._managers = { walletManager: { saveSnapshot: () => [7, 8, 9], destroy: vi.fn() }, permissionsManager: {} }
  state.walletData = { identityKey: identity, chain: 'main', close: vi.fn(async () => {}) }
  return service
}

beforeEach(() => {
  vault.endSession.mockReset().mockResolvedValue(undefined)
  vault.clearCache.mockClear()
  local = new Map(Object.entries({ payReq_abc: 'keep', ...paymentState, ...walletState }))
  vi.stubGlobal('localStorage', {
    get length() {
      return local.size
    },
    key: (i: number) => [...local.keys()][i] ?? null,
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => {
      local.set(k, v)
    },
    removeItem: (k: string) => {
      local.delete(k)
    },
    clear: () => local.clear()
  })
  vi.stubGlobal('window', {
    electronAPI: { bootConfig: { set: vi.fn(async () => {}) }, storage: { releaseNetwork: vi.fn(async () => ({ success: true })) } },
    dispatchEvent: vi.fn()
  })
  vi.stubGlobal('CustomEvent', class { constructor(public type: string, public detail?: unknown) {} })
})

describe('local state on logout', () => {
  it('keeps payment requests, payment outboxes and direct-pay state, and clears the rest', () => {
    readyService().logout()

    expect(Object.fromEntries(local)).toEqual({ payReq_abc: 'keep', ...paymentState })
  })

  it('still locks the vault and forgets the wallet in this window', () => {
    const service = readyService()
    service.logout()

    expect(vault.endSession).toHaveBeenCalledOnce()
    expect(vault.clearCache).toHaveBeenCalled()
    expect(service.wallet).toBeUndefined()
    expect(service.managers).toEqual({})
    expect(service.lifecycle).toBe('configured')
  })
})

describe('local state when the wallet is removed from the device', () => {
  it('keeps payment requests and kept direct payments: outboxes and the rest of direct-pay state are scrubbed', async () => {
    await readyService().removeWalletFromDevice()

    expect(Object.fromEntries(local)).toEqual({ payReq_abc: 'keep', ...keptPayments })
  })

  it('leaves a kept direct payment for the same wallet to add when it is opened here again', async () => {
    await readyService().removeWalletFromDevice()

    expect(listKeptDirectPayments(identity, 'main').payments).toEqual([expect.objectContaining({ txid: 'ab'.repeat(32), sender: keptPayment.payment.sender, amount: 700, payment: keptPayment.payment })])
  })

  it('does not touch the payment state when the vault cannot be wiped', async () => {
    vault.endSession.mockRejectedValue(new Error('VAULT_LOCKED'))
    await expect(readyService().removeWalletFromDevice()).rejects.toThrow('could not be removed')

    expect(Object.fromEntries(local)).toEqual({ payReq_abc: 'keep', ...paymentState, ...walletState })
  })
})

describe('_clearLocalWalletState', () => {
  it('preserves payment state only when asked', () => {
    const service = readyService() as any

    service._clearLocalWalletState({ preservePayments: true })
    expect(Object.fromEntries(local)).toEqual({ payReq_abc: 'keep', ...paymentState })

    service._clearLocalWalletState({ preservePayments: false })
    expect(Object.fromEntries(local)).toEqual({ payReq_abc: 'keep', ...keptPayments })
  })
})

describe('direct payments follow the wallet', () => {
  it('stop on logout', () => {
    const service = readyService()
    const stop = vi.spyOn(service.directPay, 'stop')
    service.logout()

    expect(stop).toHaveBeenCalledOnce()
  })

  it('stop when the wallet is closed and removed', async () => {
    const service = readyService()
    const stop = vi.spyOn(service.directPay, 'stop')
    await service.removeWalletFromDevice()

    // Closing the wallet, then forgetting it.
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('restart with the new message box client and host when the message box changes', async () => {
    const service = readyService()
    const start = vi.spyOn(service.directPay, 'start').mockResolvedValue()
    const replacement = { name: 'new peer pay client' }
    vi.spyOn(service.peerPay, 'replaceClient').mockImplementation(async () => {
      ;(service.peerPay as any)._client = replacement
    })
    local.set('bsv-desktop-direct-pay-v2', JSON.stringify({ receiveEnabled: true }))

    await service.updateMessageBoxUrl('https://box.example.com/')

    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0][0]).toMatchObject({
      wallet: (service as any)._managers.permissionsManager,
      originator: service.adminOriginator,
      identity,
      chain: 'main',
      peerPayClient: replacement,
      messageBoxUrl: service.messageBoxUrl,
      settings: { receiveEnabled: true, signaling: 'messagebox' }
    })
  })

  it('restart without a message box when it is removed', async () => {
    const service = readyService()
    const start = vi.spyOn(service.directPay, 'start').mockResolvedValue()
    vi.spyOn(service.peerPay, 'destroyClient').mockResolvedValue()

    await service.removeMessageBoxUrl()

    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0][0]).toMatchObject({ peerPayClient: null, messageBoxUrl: undefined })
  })
})

describe('message box payments are received for the open wallet', () => {
  it('stop on logout, before the message box client is reset', () => {
    const service = readyService()
    const order: string[] = []
    vi.spyOn(service.messageBoxReceiver, 'stop').mockImplementation(async () => { order.push('receiver') })
    vi.spyOn(service.peerPay, 'reset').mockImplementation(() => { order.push('peerPay') })
    service.logout()

    expect(order).toEqual(['receiver', 'peerPay'])
  })

  it('start with the new message box client and host when the message box changes', async () => {
    const service = readyService()
    vi.spyOn(service.directPay, 'start').mockResolvedValue()
    const start = vi.spyOn(service.messageBoxReceiver, 'start').mockResolvedValue()
    const replacement = { name: 'new peer pay client' }
    vi.spyOn(service.peerPay, 'replaceClient').mockImplementation(async () => {
      ;(service.peerPay as any)._client = replacement
    })

    await service.updateMessageBoxUrl('https://box.example.com/')

    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0][0]).toEqual({ client: replacement, host: service.messageBoxUrl, identity, chain: 'main' })
  })

  it('stop when the message box is removed', async () => {
    const service = readyService()
    vi.spyOn(service.directPay, 'start').mockResolvedValue()
    const start = vi.spyOn(service.messageBoxReceiver, 'start').mockResolvedValue()
    const stop = vi.spyOn(service.messageBoxReceiver, 'stop')
    vi.spyOn(service.peerPay, 'destroyClient').mockResolvedValue()

    await service.removeMessageBoxUrl()

    expect(start).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalled()
  })
})
