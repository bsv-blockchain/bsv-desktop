import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolve = vi.fn()
vi.mock('@bsv/sdk', async importOriginal => ({
  ...(await importOriginal<typeof import('@bsv/sdk')>()),
  IdentityClient: vi.fn(function (wallet: unknown) { return { resolveByIdentityKey: (a: unknown) => resolve(wallet, a) } })
}))

import { identityLabel, identityName, shortKey } from '../src/lib/utils/identityNames'

const KEY = '02' + 'ab'.repeat(32)

beforeEach(() => { resolve.mockReset() })

describe('identity names', () => {
  it('looks a name up once per wallet, so another wallet (network) asks its own (desktop review minor 10)', async () => {
    resolve.mockImplementation(async (wallet: any) => [{ name: wallet.net === 'main' ? 'Alice' : 'Alice (test)' }])
    const main = { net: 'main' } as any, test = { net: 'test' } as any
    expect(await identityName(main, 'admin', KEY)).toBe('Alice')
    expect(await identityName(main, 'admin', KEY)).toBe('Alice')
    expect(await identityName(test, 'admin', KEY)).toBe('Alice (test)')
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('falls back to the short key when there is no name, and retries a failed lookup', async () => {
    const wallet = {} as any
    resolve.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    expect(await identityLabel(wallet, 'admin', KEY)).toBe(shortKey(KEY))
    expect(await identityLabel(wallet, 'admin', KEY)).toBe(shortKey(KEY))
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('gives up waiting after the timeout but keeps the lookup for the next caller', async () => {
    const wallet = {} as any
    let done!: (v: unknown) => void
    resolve.mockImplementationOnce(() => new Promise(r => { done = r }))
    expect(await identityName(wallet, 'admin', KEY, 10)).toBe('')
    done([{ name: 'Bob' }])
    expect(await identityName(wallet, 'admin', KEY, 10)).toBe('Bob')
    expect(resolve).toHaveBeenCalledTimes(1)
  })
})
