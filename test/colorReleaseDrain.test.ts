/**
 * Renderer release drain (contract §8.2): a held txid is released to the main
 * process only after `module.isSettled(txid) === true`.
 *
 * Stability cases pinned here:
 * - an `isSettled` throw or `false` keeps the txid held, and the pass goes on;
 * - double trigger / multi-window: overlapping drains share one pass;
 * - retry: a failed release IPC is retried on the next drain;
 * - a failing `held` listing never rejects the drain.
 */

import { describe, expect, test, vi } from 'vitest'
import { createColorReleaseDrain } from '../src/lib/permissionModules/color/releaseDrain'

const A = '02' + 'aa'.repeat(32)
const T = '11'.repeat(32)
const U = '22'.repeat(32)

function mkApi (held: string[]) {
  return {
    held: vi.fn(async (_id: string, _chain: string) => [...held]),
    release: vi.fn(async (_id: string, _chain: string, _txid: string) => {}),
    onHeld: vi.fn(() => () => {})
  }
}

describe('createColorReleaseDrain', () => {
  test('releases only settled txids', async () => {
    const api = mkApi([T, U])
    const isSettled = vi.fn(async (txid: string) => txid === T)
    const drain = createColorReleaseDrain({ isSettled, api, identityKey: A, chain: 'test' })
    expect(await drain.drain()).toEqual({ released: [T] })
    expect(api.held).toHaveBeenCalledWith(A, 'test')
    expect(api.release).toHaveBeenCalledTimes(1)
    expect(api.release).toHaveBeenCalledWith(A, 'test', T)
    expect(isSettled).toHaveBeenCalledWith(U)
  })

  test('an isSettled throw keeps the txid held and the drain continues', async () => {
    const api = mkApi([T, U])
    const isSettled = vi.fn(async (txid: string) => {
      if (txid === T) throw new Error('store unavailable')
      return true
    })
    const drain = createColorReleaseDrain({ isSettled, api, identityKey: A, chain: 'test', onError: () => {} })
    expect(await drain.drain()).toEqual({ released: [U] })
    expect(api.release).toHaveBeenCalledTimes(1)
    expect(api.release).toHaveBeenCalledWith(A, 'test', U)
  })

  test('only a strict true releases', async () => {
    const api = mkApi([T])
    const drain = createColorReleaseDrain({ isSettled: async () => 'yes' as any, api, identityKey: A, chain: 'test' })
    expect(await drain.drain()).toEqual({ released: [] })
    expect(api.release).not.toHaveBeenCalled()
  })

  test('single flight: overlapping drains share one pass', async () => {
    const api = mkApi([T])
    let finish!: (v: boolean) => void
    const isSettled = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    const drain = createColorReleaseDrain({ isSettled, api, identityKey: A, chain: 'test' })
    const first = drain.drain()
    const second = drain.drain()
    expect(second).toBe(first)
    await vi.waitFor(() => expect(isSettled).toHaveBeenCalledTimes(1))
    finish(true)
    expect(await first).toEqual({ released: [T] })
    expect(api.held).toHaveBeenCalledTimes(1)
    expect(api.release).toHaveBeenCalledTimes(1)
    // a later drain is a new pass
    isSettled.mockImplementation(async () => false)
    await drain.drain()
    expect(api.held).toHaveBeenCalledTimes(2)
  })

  test('a release IPC failure is retried on the next drain', async () => {
    const api = mkApi([T])
    api.release.mockRejectedValueOnce(new Error('ipc closed'))
    const onError = vi.fn()
    const drain = createColorReleaseDrain({ isSettled: async () => true, api, identityKey: A, chain: 'test', onError })
    expect(await drain.drain()).toEqual({ released: [] })
    expect(onError).toHaveBeenCalled()
    expect(await drain.drain()).toEqual({ released: [T] })
    expect(api.release).toHaveBeenCalledTimes(2)
  })

  test('a failing held listing resolves with nothing released', async () => {
    const api = mkApi([])
    api.held.mockRejectedValueOnce(new Error('ipc closed'))
    const drain = createColorReleaseDrain({ isSettled: async () => true, api, identityKey: A, chain: 'test', onError: () => {} })
    expect(await drain.drain()).toEqual({ released: [] })
  })
})
