import { createRequire } from 'module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CachedKeyDeriver, KeyDeriver, MerklePath as EsmMerklePath, PrivateKey as EsmPrivateKey } from '@bsv/sdk'
import {
  ARCADE_BROADCASTER,
  assertArcadeCallbackToken,
  createArcadeServiceOptions,
  createArcadeServices,
  makeWocMerklePathService,
  makeWocPostBeefService,
  neverCondemns
} from '../electron/arcade'
import {
  arcadeUrl,
  chaintracksUrl,
  GORILLAPOOL_ARC_URLS,
  TAAL_ARC_URLS,
  WHATSONCHAIN_URLS
} from '../electron/endpoints'
import { deriveArcadeCallbackToken } from '../src/lib/services/createServices'

// The toolbox is CommonJS and type-checks SDK objects against its own copy of
// the SDK, so anything handed to it is built from that copy (see electron/arcade.ts).
const toolboxSdk = createRequire(createRequire(import.meta.url).resolve('@bsv/wallet-toolbox'))('@bsv/sdk') as typeof import('@bsv/sdk')
const { Beef, MerklePath, P2PKH, PrivateKey, Transaction } = toolboxSdk
type Beef = InstanceType<typeof Beef>

const CHAINS = ['main', 'test', 'ttn'] as const

/**
 * Known-answer vectors shared with bsv-wallet
 * (packages/expo-wallet-toolbox/__tests__/services/callbackToken.test.ts), so
 * the two apps cannot drift apart. The second root key's derived key has a
 * leading zero byte, which pins the unpadded hashing.
 */
const VECTORS = [
  {
    rootKey: '0f'.repeat(32),
    identityKey: '021a7a569e91dbf60581509c7fc946d1003b60c7dee85299538db6353538d59574',
    token: '474583e93a591794b36961bc963e204a'
  },
  {
    rootKey: '2bb'.padStart(64, '0'),
    identityKey: '0337cf0ed288ed8fef4ae17bcff6bfb8153e12bab2a46d7e5d2e6feb999793bef8',
    token: 'dfa4a622f1a7b25d1acc9cacb4449443'
  }
]
const TOKEN = VECTORS[0].token

// A real BUMP, taken from a mined teratestnet transaction, so parsing is
// exercised rather than asserted against a stub.
const BUMP =
  'fd078301020102da0016ed2d6f96096354528606597ef1a5aef17652a35a6b63b0abb2239cee76' +
  '00007232a54ce5fc358a89d7df7d4d2c7162ea02c2eabd34b77f24ce0556b3acf657'

type Reply = { status?: number, json?: unknown, text?: string } | Error

/** Stubs global fetch. Must run before Services is built: the SDK binds fetch at construction. */
function mockFetch(handler: (url: string, init: RequestInit) => Reply) {
  const fn = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    const reply = handler(String(input), init)
    if (reply instanceof Error) throw reply
    const status = reply.status ?? 200
    if (reply.text !== undefined) {
      return new Response(reply.text, { status, headers: { 'Content-Type': 'text/plain' } })
    }
    return new Response(JSON.stringify(reply.json ?? {}), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** A signed transaction whose Beef carries its parent, so Extended Format can be built. */
async function spendableBeef(): Promise<{ beef: Beef, txid: string, efHex: string }> {
  const key = new PrivateKey(42)
  const parent = new Transaction()
  parent.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 1000 })
  const child = new Transaction()
  child.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(key) })
  child.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 900 })
  await child.sign()
  const beef = new Beef()
  beef.mergeTransaction(parent)
  beef.mergeTransaction(child)
  return { beef, txid: child.id('hex'), efHex: child.toHexEF() }
}

const names = (collection: { services: Array<{ name: string }> }) => collection.services.map(s => s.name)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('deriveArcadeCallbackToken', () => {
  it('matches bsv-wallet\'s known-answer vectors', () => {
    for (const v of VECTORS) {
      const keyDeriver = new KeyDeriver(EsmPrivateKey.fromHex(v.rootKey))
      expect(keyDeriver.identityKey).toBe(v.identityKey)
      expect(deriveArcadeCallbackToken(keyDeriver), v.rootKey).toBe(v.token)
    }
  })

  it('gives the same token through the cached key deriver the wallet is built with', () => {
    for (const v of VECTORS) {
      expect(deriveArcadeCallbackToken(new CachedKeyDeriver(EsmPrivateKey.fromHex(v.rootKey)))).toBe(v.token)
    }
  })

  it('is not taken from the identity key', () => {
    for (const v of VECTORS) {
      expect(v.identityKey).not.toContain(v.token)
    }
  })

  it('is accepted by the main process', () => {
    for (const v of VECTORS) expect(assertArcadeCallbackToken(v.token)).toBe(v.token)
  })
})

describe('assertArcadeCallbackToken', () => {
  it('refuses anything that is not 32 lowercase hex characters', () => {
    for (const bad of [undefined, null, '', TOKEN.slice(1), TOKEN + '0', TOKEN.toUpperCase(), 'zz'.repeat(16), VECTORS[0].identityKey]) {
      expect(() => assertArcadeCallbackToken(bad), String(bad)).toThrow()
    }
  })
})

describe('createArcadeServiceOptions', () => {
  it('points Arcade, ChainTracks and the fallbacks at the same hosts as bsv-wallet on every chain', () => {
    for (const chain of CHAINS) {
      const o = createArcadeServiceOptions(chain, TOKEN)
      expect(o.arcadeUrl, chain).toBe(arcadeUrl(chain))
      expect((o.chaintracks as any).serviceUrl, chain).toBe(chaintracksUrl(chain))
      expect(o.arcUrl, chain).toBe(TAAL_ARC_URLS[chain] ?? '')
      expect(o.arcGorillaPoolUrl, chain).toBe(GORILLAPOOL_ARC_URLS[chain])
    }
  })

  it('gives Arcade the callback token and asks for every status transition', () => {
    for (const chain of CHAINS) {
      const cfg = createArcadeServiceOptions(chain, TOKEN).arcadeConfig as any
      expect(cfg.callbackToken, chain).toBe(TOKEN)
      expect(cfg.headers, chain).toEqual({ 'X-FullStatusUpdates': 'true' })
    }
  })

  it('will not build Arcade services without a well-formed token', () => {
    expect(() => createArcadeServiceOptions('main', undefined as any)).toThrow()
    expect(() => createArcadeServices('main', VECTORS[0].identityKey)).toThrow()
  })
})

describe('createArcadeServices', () => {
  it('builds the toolbox Arcade provider, which is what TaskArcadeSSE keys off', () => {
    for (const chain of CHAINS) {
      const services = createArcadeServices(chain, TOKEN)
      expect(services.arcade, chain).toBeDefined()
      expect(services.options.arcadeUrl, chain).toBe(arcadeUrl(chain))
    }
  })

  it('broadcasts in bsv-wallet order: Arcade, TAAL, GorillaPool, WhatsOnChain, Bitails', () => {
    expect(names(createArcadeServices('main', TOKEN).postBeefServices))
      .toEqual([ARCADE_BROADCASTER, 'TaalArcBeef', 'GorillaPoolArcBeef', 'WhatsOnChain', 'Bitails'])
    expect(names(createArcadeServices('test', TOKEN).postBeefServices))
      .toEqual([ARCADE_BROADCASTER, 'TaalArcBeef', 'WhatsOnChain', 'Bitails'])
    expect(names(createArcadeServices('ttn', TOKEN).postBeefServices))
      .toEqual([ARCADE_BROADCASTER, 'WhatsOnChain'])
  })

  it('looks up proofs from Arcade first on every chain', () => {
    expect(names(createArcadeServices('main', TOKEN).getMerklePathServices))
      .toEqual(['Arcade', 'WhatsOnChain', 'Bitails'])
    expect(names(createArcadeServices('test', TOKEN).getMerklePathServices))
      .toEqual(['Arcade', 'WhatsOnChain', 'Bitails'])
    expect(names(createArcadeServices('ttn', TOKEN).getMerklePathServices))
      .toEqual(['Arcade', 'WhatsOnChain'])
  })

  it('posts Extended Format to Arcade /tx with the callback token and full-status header', async () => {
    const { beef, txid, efHex } = await spendableBeef()
    const fetchMock = mockFetch(() => ({ status: 202, json: { txid, txStatus: 'RECEIVED' } }))
    const services = createArcadeServices('main', TOKEN)

    const results = await services.postBeef(beef, [txid])

    expect(results.map(r => r.status)).toEqual(['success'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${arcadeUrl('main')}/tx`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['X-CallbackToken']).toBe(TOKEN)
    expect(headers['X-FullStatusUpdates']).toBe('true')
    expect(JSON.parse(String(init.body))).toEqual({ rawTx: efHex })
  })

  it('falls back when Arcade is unreachable, and keeps Arcade first for the next send', async () => {
    const { beef, txid } = await spendableBeef()
    mockFetch(url => url.startsWith(arcadeUrl('ttn'))
      ? { status: 503, json: { detail: 'no available server' } }
      : { text: txid })
    const services = createArcadeServices('ttn', TOKEN)

    const results = await services.postBeef(beef, [txid])

    expect(results.map(r => [r.name, r.status])).toEqual([[ARCADE_BROADCASTER, 'error'], ['WhatsOnChain', 'success']])
    expect(results[0].txidResults[0].serviceError).toBe(true)
    // The toolbox would otherwise move the failed provider to the back for good,
    // routing every later send past Arcade and its SSE reporting.
    expect(names(services.postBeefServices)[0]).toBe(ARCADE_BROADCASTER)
  })

  it('lets only Arcade condemn a transaction', async () => {
    const { beef, txid } = await spendableBeef()
    mockFetch(url => url.startsWith(arcadeUrl('main'))
      ? { status: 400, json: { txid, txStatus: 'REJECTED', extraInfo: 'script verification failed' } }
      : { status: 400, json: { txid, txStatus: 'REJECTED', detail: 'Missing inputs', error: 'Missing inputs' } })
    const services = createArcadeServices('main', TOKEN)

    const results = await services.postBeef(beef, [txid])

    expect(results.length).toBeGreaterThan(1)
    const [arcade, ...fallbacks] = results
    expect(arcade.txidResults[0].status).toBe('error')
    expect(arcade.txidResults[0].serviceError).toBeFalsy()
    for (const r of fallbacks) {
      for (const tr of r.txidResults) {
        expect(tr.status === 'success' || tr.serviceError === true, `${r.name}`).toBe(true)
      }
    }
  })
})

describe('proofs through the toolbox', () => {
  const bumpTxid = () => MerklePath.fromHex(BUMP).path[0].find(leaf => leaf.txid === true)!.hash!

  /** A ttn Services whose chain tracker accepts any root, so only the proof's shape is on trial. */
  function ttnServicesAcceptingAnyRoot() {
    const services = createArcadeServices('ttn', TOKEN)
    services.getChainTracker = async () => ({ isValidRootForHeight: async () => true, currentHeight: async () => 40_000 }) as any
    ;(services.options.chaintracks as any).findHeaderForHeight = async () => undefined
    return services
  }

  it('accepts a WhatsOnChain proof when Arcade has none (ttn)', async () => {
    const txid = bumpTxid()
    mockFetch(url => url.startsWith(arcadeUrl('ttn'))
      ? { status: 404, json: { error: 'transaction not found' } }
      : { text: BUMP })
    const services = ttnServicesAcceptingAnyRoot()

    const r = await services.getMerklePath(txid)

    expect(r.name).toBe('WhatsOnChain')
    expect(r.merklePath?.blockHeight).toBe(33543)
  })

  it('refuses a proof built from the ESM SDK, which is why ours comes from the toolbox copy', async () => {
    const txid = bumpTxid()
    mockFetch(() => ({ status: 404, json: {} }))
    const services = ttnServicesAcceptingAnyRoot()
    services.getMerklePathServices.services = [{
      name: 'esm',
      service: async () => ({ name: 'esm', merklePath: EsmMerklePath.fromHex(BUMP) as any, notes: [] })
    }]

    const r = await services.getMerklePath(txid)

    expect(r.merklePath).toBeUndefined()
  })
})

describe('neverCondemns', () => {
  const beef = new Beef()
  const wrap = (txidResults: any[]) => neverCondemns(async () => ({ name: 'x', status: 'error', txidResults }))

  it('turns a refusal into a service error', async () => {
    const r = await wrap([{ txid: 'a', status: 'error' }])(beef, ['a'])
    expect(r.txidResults[0].serviceError).toBe(true)
  })

  it('keeps a double spend and leaves acceptance alone', async () => {
    const r = await wrap([
      { txid: 'a', status: 'error', doubleSpend: true },
      { txid: 'b', status: 'success' }
    ])(beef, ['a', 'b'])
    expect(r.txidResults[0].serviceError).toBeUndefined()
    expect(r.txidResults[0].doubleSpend).toBe(true)
    expect(r.txidResults[1].serviceError).toBeUndefined()
  })
})

describe('makeWocPostBeefService', () => {
  it('posts raw hex to the chain\'s /tx/raw', async () => {
    const { beef, txid } = await spendableBeef()
    const fetchMock = mockFetch(() => ({ text: txid }))
    const r = await makeWocPostBeefService(WHATSONCHAIN_URLS.ttn)(beef, [txid])
    expect(r.status).toBe('success')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.woc-ttn.bsvblockchain.tech/v1/bsv/test/tx/raw')
    expect(JSON.parse(String(init.body)).txhex).toBe(beef.findTxid(txid)!.tx!.toHex())
  })

  it('pauses between dependent transactions, as the toolbox\'s WhatsOnChain provider does', async () => {
    const { beef, txid } = await spendableBeef()
    const parentTxid = beef.txs[0].txid
    const at: number[] = []
    mockFetch(() => { at.push(performance.now()); return { text: 'ok' } })

    const r = await makeWocPostBeefService(WHATSONCHAIN_URLS.ttn, 60)(beef, [parentTxid, txid])

    expect(r.txidResults.map(tr => tr.status)).toEqual(['success', 'success'])
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(55)
  })

  it('accepts an identical rebroadcast', async () => {
    const { beef, txid } = await spendableBeef()
    mockFetch(() => ({ status: 400, text: 'Transaction already in the mempool' }))
    const r = await makeWocPostBeefService(WHATSONCHAIN_URLS.ttn)(beef, [txid])
    expect(r.txidResults[0].status).toBe('success')
  })

  it('never reports a refusal or an outage as a verdict', async () => {
    const { beef, txid } = await spendableBeef()
    for (const reply of [{ status: 400, text: 'Missing inputs' }, new Error('ECONNRESET')] as Reply[]) {
      mockFetch(() => reply)
      const r = await makeWocPostBeefService(WHATSONCHAIN_URLS.ttn)(beef, [txid])
      expect(r.status).toBe('error')
      expect(r.txidResults[0].serviceError).toBe(true)
      expect(r.txidResults[0].doubleSpend).toBeFalsy()
    }
  })
})

describe('makeWocMerklePathService', () => {
  it('reads the BUMP and attaches the header ChainTracks has for its height', async () => {
    const fetchMock = mockFetch(() => ({ text: BUMP }))
    const header = { version: 1, previousHash: '00', merkleRoot: '11', time: 0, bits: 0, nonce: 0, hash: '22' }
    const services = { options: { chaintracks: { findHeaderForHeight: vi.fn(async () => header) } } }

    const r = await makeWocMerklePathService(WHATSONCHAIN_URLS.ttn)('abc', services as any)

    expect(fetchMock.mock.calls[0][0]).toBe(`${WHATSONCHAIN_URLS.ttn}/tx/abc/proof/bump`)
    expect(r.merklePath?.blockHeight).toBe(33543)
    expect(r.header).toEqual({ ...header, height: 33543 })
    expect(services.options.chaintracks.findHeaderForHeight).toHaveBeenCalledWith(33543)
  })

  it('keeps the proof when the header lookup fails', async () => {
    mockFetch(() => ({ text: BUMP }))
    const services = { options: { chaintracks: { findHeaderForHeight: vi.fn(async () => { throw new Error('ChainTracks down') }) } } }

    const r = await makeWocMerklePathService(WHATSONCHAIN_URLS.ttn)('abc', services as any)

    expect(r.merklePath?.blockHeight).toBe(33543)
    expect(r.header).toBeUndefined()
  })

  it('returns no path when WhatsOnChain has none, or cannot be reached', async () => {
    for (const reply of [{ status: 404, text: 'not found' }, new Error('ECONNRESET')] as Reply[]) {
      mockFetch(() => reply)
      const r = await makeWocMerklePathService(WHATSONCHAIN_URLS.ttn)('abc', {} as any)
      expect(r.merklePath).toBeUndefined()
      expect(r.error).toBeUndefined()
    }
  })
})
