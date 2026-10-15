import { afterEach, describe, expect, it, vi } from 'vitest'
import { RateLimitedFetch } from '../src/lib/utils/RateLimitedFetch'

afterEach(() => vi.unstubAllGlobals())

describe('RateLimitedFetch (#115 receive watcher)', () => {
  it('gives up on a stalled request so later requests are not blocked forever', async () => {
    let calls = 0
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      calls++
      if (calls === 1) {
        // Never answers; only the abort signal can end it.
        return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))
      }
      return Promise.resolve(new Response('ok'))
    })
    const queue = new RateLimitedFetch(1000, 0, 30)
    const stalled = queue.fetch('https://example.test/a')
    const next = queue.fetch('https://example.test/b')
    await expect(stalled).rejects.toThrow()
    await expect((await next).text()).resolves.toBe('ok')
  })
})
