import { describe, expect, it, vi } from 'vitest'
import { readRecentActions } from '../src/lib/utils/walletOverview'

describe('wallet overview provider boundaries', () => {
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
