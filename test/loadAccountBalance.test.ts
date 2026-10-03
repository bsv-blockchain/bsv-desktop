import { describe, expect, test, vi } from 'vitest'
import type { WalletInterface } from '@bsv/sdk'
import { sdk as WalletToolboxSdk } from '@bsv/wallet-toolbox-client'
import { loadAccountBalance } from '../src/lib/utils/loadAccountBalance'

describe('bounded wallet balance reads', () => {
  test('returns the special-operation satoshi total from one empty-output response', async () => {
    const listOutputs = vi.fn().mockResolvedValue({ totalOutputs: 1_234_567, outputs: [] })
    const wallet = { listOutputs } as unknown as WalletInterface
    await expect(loadAccountBalance(wallet, 'wallet.internal')).resolves.toBe(1_234_567)
    expect(listOutputs).toHaveBeenCalledExactlyOnceWith(
      { basket: WalletToolboxSdk.specOpWalletBalance }, 'wallet.internal'
    )
  })

  test('keeps named basket scope while requesting the balance operation', async () => {
    const listOutputs = vi.fn().mockResolvedValue({ totalOutputs: 99, outputs: [] })
    const wallet = { listOutputs } as unknown as WalletInterface
    await expect(loadAccountBalance(wallet, 'wallet.internal', 'application')).resolves.toBe(99)
    expect(listOutputs).toHaveBeenCalledExactlyOnceWith(
      { basket: 'application', tags: [WalletToolboxSdk.specOpWalletBalance] }, 'wallet.internal'
    )
  })

  test('propagates a failed storage read instead of reporting a zero balance', async () => {
    const listOutputs = vi.fn().mockRejectedValue(new Error('Storage unavailable'))
    const wallet = { listOutputs } as unknown as WalletInterface
    await expect(loadAccountBalance(wallet, 'wallet.internal')).rejects.toThrow('Storage unavailable')
    expect(listOutputs).toHaveBeenCalledTimes(1)
  })
})
