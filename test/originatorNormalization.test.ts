import { describe, expect, it, vi } from 'vitest'
import { WalletPermissionsManager } from '@bsv/wallet-toolbox-client'
import { RequestInterceptorWallet } from '../src/lib/RequestInterceptorWallet'
import { normalizeOriginator } from '../src/lib/utils/normalizeOriginator'

describe('app spends count against their limit (#93)', () => {
  it('matches the permissions manager normalization', () => {
    const pm = Object.create(WalletPermissionsManager.prototype)
    for (const o of ['localhost:3000', 'https://App.Example.com:8443', 'app.example.com', '[::1]:3000', 'http://127.0.0.1:5173']) {
      expect(normalizeOriginator(o)).toBe(pm.normalizeOriginator(o))
    }
  })

  it('labels createAction with the hostname but records the full origin as a recent app', async () => {
    const underlying = { createAction: vi.fn(async () => ({ txid: 'ab' })) }
    const recent = vi.fn()
    const wallet = new RequestInterceptorWallet(underlying as any, 'profile', recent)
    await wallet.createAction({ description: 'play', outputs: [] } as any, 'localhost:3000')
    expect(underlying.createAction).toHaveBeenCalledWith({ description: 'play', outputs: [] }, 'localhost')
    expect(recent).toHaveBeenCalledWith('profile', 'localhost:3000')
  })
})
