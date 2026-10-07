import { describe, expect, it, vi } from 'vitest'
import { readWalletBalance, readRecentActions } from '../src/lib/utils/walletOverview'

describe('wallet overview provider boundaries', () => {
  it('sums outputs across pages rather than showing a truncated balance', async () => {
    const listOutputs = vi.fn().mockResolvedValueOnce({ totalOutputs: 3, outputs: [{ satoshis: 10 }, { satoshis: 20 }] }).mockResolvedValueOnce({ totalOutputs: 3, outputs: [{ satoshis: 30 }] })
    expect(await readWalletBalance({ listOutputs } as any, 'admin')).toBe(60)
    expect(listOutputs.mock.calls[1][0].offset).toBe(2)
  })
  it('fails instead of looping forever on an incomplete storage response', async () => {
    const listOutputs = vi.fn().mockResolvedValue({ totalOutputs: 3, outputs: [] })
    await expect(readWalletBalance({ listOutputs } as any, 'admin')).rejects.toThrow('did not return all balance outputs')
    expect(listOutputs).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid amounts rather than displaying a false balance', async () => {
    const listOutputs = vi.fn().mockResolvedValue({ totalOutputs: 1, outputs: [{ satoshis: -1 }] })
    await expect(readWalletBalance({ listOutputs } as any, 'admin')).rejects.toThrow('invalid output amount')
  })
  it('shows the newest transactions when the storage returns oldest first', async () => {
    const listActions = vi.fn().mockResolvedValueOnce({ totalActions: 100, actions: [] }).mockResolvedValueOnce({ totalActions: 100, actions: Array.from({ length: 30 }, (_, i) => ({ txid: String(70 + i) })) })
    const result = await readRecentActions({ listActions } as any, 'admin', 30)
    expect(listActions.mock.calls[1][0]).toEqual({ labels: [], limit: 30, offset: 70 })
    expect(result.actions[0].txid).toBe('99')
    expect(result.actions[29].txid).toBe('70')
  })
  it('keeps provider requests bounded while loading a long activity history', async () => {
    const listActions = vi.fn().mockImplementation(async ({ limit, offset }) => ({ totalActions: 15000, actions: Array.from({ length: limit }, (_, i) => ({ txid: String(offset + i) })) }))
    const result = await readRecentActions({ listActions } as any, 'admin', 12000)
    expect(listActions.mock.calls.every(([args]) => args.limit <= 1000)).toBe(true)
    expect(result.actions).toHaveLength(12000)
    expect(result.actions[0].txid).toBe('14999')
    expect(result.actions[11999].txid).toBe('3000')
  })
})
