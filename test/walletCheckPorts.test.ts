import { describe, it, expect, vi } from 'vitest'
import { createWalletCheckPorts, type WalletCheckDeps } from '../src/lib/services/walletCheck/ports'

function deps(over: Partial<WalletCheckDeps> = {}): WalletCheckDeps {
  return {
    wallet: { getHeight: vi.fn(async () => ({ height: 900000 })) },
    walletClass: {
      listFailedActions: vi.fn(async () => ({ totalActions: 0 })),
      reviewSpendableOutputs: vi.fn(async () => ({ totalOutputs: 0 })),
    },
    peerPay: () => ({ client: { listIncomingPayments: vi.fn(async () => []), acceptPayment: vi.fn(async () => ({})) }, isHostAnointed: true }),
    useMessageBox: () => true,
    setMessageBoxUrl: vi.fn(async () => {}),
    anoint: vi.fn(async () => {}),
    refreshAppWallet: vi.fn(async () => {}),
    repairCertTrust: vi.fn(async () => ({ trusted: true, repaired: false })),
    profileId: [1, 2, 3],
    fetch: vi.fn(async () => ({ ok: true, status: 200 })),
    sleep: vi.fn(async () => {}),
    storage: { getItem: () => '2026-10-10T00:00:00.000Z' },
    hasLocalAdvertisement: vi.fn(async () => false),
    ...over,
  }
}

describe('network', () => {
  it('retries twice with backoff, then fails with an online hint', async () => {
    const d = deps({ wallet: { ...deps().wallet, getHeight: vi.fn(async () => { throw new Error('offline') }) } })
    const out = await createWalletCheckPorts(d).network()
    expect(d.wallet.getHeight).toHaveBeenCalledTimes(3)
    expect(d.sleep).toHaveBeenNthCalledWith(1, 1000)
    expect(d.sleep).toHaveBeenNthCalledWith(2, 2000)
    expect(out.status).toBe('error')
    expect(out.message).toMatch(/online/)
  })
  it('passes on a later attempt', async () => {
    const getHeight = vi.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValueOnce({ height: 1 })
    const out = await createWalletCheckPorts(deps({ wallet: { ...deps().wallet, getHeight } })).network()
    expect(out.status).toBe('ok')
  })
})

describe('connections', () => {
  it('leaves a healthy bridge alone', async () => {
    const d = deps()
    const out = await createWalletCheckPorts(d).connections()
    expect(d.refreshAppWallet).not.toHaveBeenCalled()
    expect(out).toMatchObject({ status: 'ok', message: 'Apps can reach your wallet' })
  })
  it('reconnects the bridge when the probe fails, then reports fixed', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ ok: true, status: 200 })
    const d = deps({ fetch })
    const out = await createWalletCheckPorts(d).connections()
    expect(d.refreshAppWallet).toHaveBeenCalledTimes(1)
    expect(out.status).toBe('ok')
    expect(out.fixed).toContain('Reconnected apps to your wallet')
  })
  it('tells the user to restart when the bridge stays down', async () => {
    const out = await createWalletCheckPorts(deps({ fetch: vi.fn(async () => { throw new Error('down') }) })).connections()
    expect(out).toMatchObject({ status: 'error', message: 'Apps cannot reach your wallet. Restart BSV Desktop.' })
  })
  it('reports a repaired certificate and an untrusted one', async () => {
    const fixedOut = await createWalletCheckPorts(deps({ repairCertTrust: async () => ({ trusted: true, repaired: true }) })).connections()
    expect(fixedOut.fixed).toContain('Trusted the secure app connection')
    const badOut = await createWalletCheckPorts(deps({ repairCertTrust: async () => ({ trusted: false, repaired: false }) })).connections()
    expect(badOut.status).toBe('error')
  })
})

describe('transactions', () => {
  it('retries failed transactions', async () => {
    const d = deps({ walletClass: { ...deps().walletClass!, listFailedActions: vi.fn(async () => ({ totalActions: 2 })) } })
    const out = await createWalletCheckPorts(d).transactions()
    expect(d.walletClass!.listFailedActions).toHaveBeenCalledWith({ labels: [], limit: 1000 }, true)
    expect(out.fixed).toEqual(['Retried 2 failed transaction(s)'])
  })
  it('reports fine when nothing needs fixing', async () => {
    const out = await createWalletCheckPorts(deps()).transactions()
    expect(out.status).toBe('ok')
    expect(out.message).toBe('Transactions are fine')
    expect(out.fixed ?? []).toEqual([])
  })
  it('is skipped with remote storage', async () => {
    const out = await createWalletCheckPorts(deps({ walletClass: null })).transactions()
    expect(out).toEqual({ status: 'skipped', message: 'Not available with remote storage' })
    const coins = await createWalletCheckPorts(deps({ walletClass: null })).coins()
    expect(coins.status).toBe('skipped')
  })
})

describe('coins', () => {
  it('releases spent coins', async () => {
    const d = deps({ walletClass: { ...deps().walletClass!, reviewSpendableOutputs: vi.fn(async () => ({ totalOutputs: 3 })) } })
    const out = await createWalletCheckPorts(d).coins()
    expect(d.walletClass!.reviewSpendableOutputs).toHaveBeenCalledWith(true, true)
    expect(out.fixed).toEqual(['Updated 3 coin(s) that were already spent'])
  })
})

describe('messageBox', () => {
  it('sets the default host and anoints when nothing is configured', async () => {
    let client: any = null
    const d = deps({
      useMessageBox: () => false,
      setMessageBoxUrl: vi.fn(async () => { client = { listIncomingPayments: async () => [], acceptPayment: async () => ({}) } }),
      peerPay: () => ({ client, isHostAnointed: false }),
    })
    const out = await createWalletCheckPorts(d).messageBox()
    expect(d.setMessageBoxUrl).toHaveBeenCalledWith('https://messagebox.bsvblockchain.tech')
    expect(d.anoint).toHaveBeenCalled()
    expect(out.fixed).toEqual(['Set up your message box', 'Made you discoverable for payments'])
  })
  it('asks for funds when anointing fails for lack of them', async () => {
    const d = deps({ peerPay: () => ({ client: {} as any, isHostAnointed: false }), anoint: vi.fn(async () => { throw new Error('Insufficient funds in the available inputs') }) })
    const out = await createWalletCheckPorts(d).messageBox()
    expect(out).toMatchObject({ status: 'attention', action: { label: 'Get paid', to: '/dashboard/payments?tab=receive' } })
  })
})

describe('messageBox advertisement', () => {
  it('does not anoint when a local advertisement already exists', async () => {
    const d = deps({ peerPay: () => ({ client: {} as any, isHostAnointed: false }), hasLocalAdvertisement: vi.fn(async () => true) })
    const out = await createWalletCheckPorts(d).messageBox()
    expect(out.status).toBe('ok')
    expect(d.anoint).not.toHaveBeenCalled()
  })
})

describe('payments', () => {
  it('accepts everything waiting and sums the amount', async () => {
    const acceptPayment = vi.fn(async () => ({}))
    const d = deps({ peerPay: () => ({ client: { listIncomingPayments: async () => [{ token: { amount: 500 } }, { token: { amount: 1000 } }], acceptPayment }, isHostAnointed: true }) })
    const out = await createWalletCheckPorts(d).payments()
    expect(acceptPayment).toHaveBeenCalledTimes(2)
    expect(out.fixed).toEqual(['Received 2 payment(s) (1500 sats)'])
  })
  it('is skipped without a message box client', async () => {
    const out = await createWalletCheckPorts(deps({ peerPay: () => ({ client: null, isHostAnointed: false }) })).payments()
    expect(out.status).toBe('skipped')
  })
})

describe('backup', () => {
  it('asks the user to back up when no marker exists', async () => {
    const out = await createWalletCheckPorts(deps({ storage: { getItem: () => null } })).backup()
    expect(out).toMatchObject({ status: 'attention', action: { label: 'Back up now', to: '/dashboard/settings/backup' } })
  })
  it('passes with a marker', async () => {
    expect((await createWalletCheckPorts(deps()).backup()).status).toBe('ok')
  })
})
