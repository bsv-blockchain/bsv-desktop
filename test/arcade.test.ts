import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  arcadeBroadcast,
  arcadeTxStatus,
  installArcadeServices,
  makeArcadeMerklePathService,
  makeArcadePostBeefService
} from '../electron/arcade'
import { arcadeUrl } from '../electron/endpoints'

const BASE = 'https://arcade.example'

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const res = handler(String(input), init)
    if (res instanceof Error) throw res
    const { status = 200, body = {} } = res as { status?: number; body?: unknown }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('arcadeBroadcast', () => {
  it('posts extended-format hex to /tx, not /v1/tx', async () => {
    // The whole reason this adapter exists: the toolbox ARC provider posts to
    // /v1/tx, which Arcade does not serve.
    const fetchMock = mockFetch(() => ({ body: { txid: 'abc', txStatus: 'RECEIVED' } }))
    await arcadeBroadcast(BASE, 'deadbeef')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/tx`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ rawTx: 'deadbeef' })
  })

  it('treats every accepted status as success', async () => {
    for (const txStatus of ['RECEIVED', 'SEEN_ON_NETWORK', 'SEEN_MULTIPLE_NODES', 'MINED']) {
      mockFetch(() => ({ body: { txid: 'abc', txStatus } }))
      const r = await arcadeBroadcast(BASE, 'aa')
      expect(r.ok, txStatus).toBe(true)
      expect(r.rejected, txStatus).toBe(false)
    }
  })

  it('reports a spent input as a double spend rather than a plain rejection', async () => {
    mockFetch(() => ({
      body: {
        txid: 'abc',
        txStatus: 'REJECTED',
        extraInfo: 'UTXO_SPENT (70): aa:1 utxo already spent by tx bb'
      }
    }))
    const r = await arcadeBroadcast(BASE, 'aa')
    expect(r.ok).toBe(false)
    expect(r.doubleSpend).toBe(true)
    expect(r.rejected).toBe(false)
  })

  it('reports an outright rejection as rejected', async () => {
    mockFetch(() => ({ body: { txid: 'abc', txStatus: 'REJECTED', extraInfo: 'bad script' } }))
    const r = await arcadeBroadcast(BASE, 'aa')
    expect(r.rejected).toBe(true)
    expect(r.doubleSpend).toBe(false)
  })

  it('does not treat a transport failure as a verdict on the transaction', async () => {
    // Otherwise a dropped connection permanently fails a valid transaction.
    mockFetch(() => new Error('ECONNRESET'))
    const r = await arcadeBroadcast(BASE, 'aa')
    expect(r.ok).toBe(false)
    expect(r.rejected).toBe(false)
    expect(r.doubleSpend).toBe(false)
  })
})

describe('arcadeTxStatus', () => {
  it('reads status, height and merkle path', async () => {
    mockFetch(() => ({
      body: { txid: 'abc', txStatus: 'MINED', blockHeight: 33543, merklePath: 'fe0102' }
    }))
    const st = await arcadeTxStatus(BASE, 'abc')
    expect(st).toMatchObject({ txStatus: 'MINED', blockHeight: 33543, merklePath: 'fe0102' })
  })

  it('returns undefined for an unknown transaction', async () => {
    mockFetch(() => ({ status: 404, body: { error: 'transaction not found' } }))
    expect(await arcadeTxStatus(BASE, 'abc')).toBeUndefined()
  })

  it('returns undefined rather than throwing when arcade is unreachable', async () => {
    mockFetch(() => new Error('ENOTFOUND'))
    expect(await arcadeTxStatus(BASE, 'abc')).toBeUndefined()
  })

  it('omits an empty merkle path', async () => {
    mockFetch(() => ({ body: { txid: 'abc', txStatus: 'SEEN_ON_NETWORK', merklePath: '' } }))
    const st = await arcadeTxStatus(BASE, 'abc')
    expect(st?.merklePath).toBeUndefined()
  })
})

describe('postBeef service', () => {
  const beefWith = (hexEF: string, txid: string) =>
    ({
      findAtomicTransaction: (t: string) => (t === txid ? { toHexEF: () => hexEF, toHex: () => 'raw' } : undefined),
      findTxid: () => undefined
    }) as never

  it('submits the subject transaction and reports success', async () => {
    const fetchMock = mockFetch(() => ({ body: { txid: 'subject', txStatus: 'SEEN_ON_NETWORK' } }))
    const svc = makeArcadePostBeefService(BASE)
    const r = await svc(beefWith('ef00', 'subject'), ['ancestor', 'subject'])

    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      rawTx: 'ef00'
    })
    expect(r.status).toBe('success')
    expect(r.txidResults.find(t => t.txid === 'subject')?.status).toBe('success')
    // Ancestors ride inside the extended format and are accepted with it.
    expect(r.txidResults.find(t => t.txid === 'ancestor')?.status).toBe('success')
  })

  it('marks a rejection as final but an outage as retryable', async () => {
    const svc = makeArcadePostBeefService(BASE)

    mockFetch(() => ({ body: { txid: 'subject', txStatus: 'REJECTED', extraInfo: 'bad script' } }))
    const rejected = await svc(beefWith('ef00', 'subject'), ['subject'])
    expect(rejected.status).toBe('error')
    expect(rejected.txidResults[0].serviceError).toBeUndefined()

    mockFetch(() => new Error('ECONNRESET'))
    const outage = await svc(beefWith('ef00', 'subject'), ['subject'])
    expect(outage.status).toBe('error')
    expect(outage.txidResults[0].serviceError).toBe(true)
  })

  it('fails cleanly when the beef does not contain the subject', async () => {
    mockFetch(() => ({ body: {} }))
    const svc = makeArcadePostBeefService(BASE)
    const empty = { findAtomicTransaction: () => undefined, findTxid: () => undefined } as never
    const r = await svc(empty, ['missing'])
    expect(r.status).toBe('error')
    expect(r.txidResults[0].serviceError).toBe(true)
  })
})

describe('getMerklePath service', () => {
  it('returns a path once the transaction is mined', async () => {
    // A real BUMP, taken from a mined teratestnet transaction, so this exercises
    // MerklePath parsing rather than asserting against a stub.
    const bump =
      'fd078301020102da0016ed2d6f96096354528606597ef1a5aef17652a35a6b63b0abb2239cee76' +
      '00007232a54ce5fc358a89d7df7d4d2c7162ea02c2eabd34b77f24ce0556b3acf657'
    mockFetch(() => ({
      body: { txid: 'abc', txStatus: 'MINED', blockHeight: 33543, merklePath: bump }
    }))
    const r = await makeArcadeMerklePathService(BASE)('abc')
    expect(r.name).toBe('arcade')
    expect(r.merklePath).toBeDefined()
    expect(r.merklePath?.blockHeight).toBe(33543)
  })

  it('returns no path while the transaction is unmined', async () => {
    mockFetch(() => ({ body: { txid: 'abc', txStatus: 'SEEN_ON_NETWORK' } }))
    const r = await makeArcadeMerklePathService(BASE)('abc')
    expect(r.merklePath).toBeUndefined()
  })
})

describe('installArcadeServices', () => {
  it('replaces the defaults so another chain cannot decide a transaction', () => {
    const services = {
      postBeefServices: { services: [{ name: 'arcTaal' }, { name: 'Bitails' }] },
      getMerklePathServices: { services: [{ name: 'WhatsOnChain' }] }
    }
    const url = installArcadeServices(services, 'ttn')

    expect(url).toBe(arcadeUrl('ttn'))
    expect(services.postBeefServices.services.map(s => s.name)).toEqual(['arcade'])
    expect(services.getMerklePathServices.services.map(s => s.name)).toEqual(['arcade'])
  })

  it('uses the arcade deployment for each chain', () => {
    for (const chain of ['main', 'test', 'ttn'] as const) {
      const services = {
        postBeefServices: { services: [] },
        getMerklePathServices: { services: [] }
      }
      expect(installArcadeServices(services, chain)).toBe(arcadeUrl(chain))
    }
  })
})
