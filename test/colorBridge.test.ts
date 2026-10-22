// Task 13 (plan 06): large attested receipts, hand-over evidence and typed
// errors through the BRC-100 HTTP bridge (D4, D22, D29, D30).
//
// Stability cases pinned here:
// - a retry of the same failing call yields the same body (bridgeErrorBody is pure);
// - concurrent failing requests do not share state (no module-level error cache);
// - a minified build keeps `name`: the helper reads the `name` property and
//   never `constructor.name` (Vite/esbuild mangles class names).
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  HTTPWalletJSON,
  LockingScript,
  Transaction,
  UnlockingScript,
  type WalletInterface
} from '@bsv/sdk'
import { WalletPermissionsManager } from '@bsv/wallet-toolbox-client'
import { HTTP_JSON_BODY_LIMIT } from '../electron/httpLimits'
import { parseWalletPayload, stringifyWalletPayload } from '../src/walletByteJson'

const mockOnHttpRequest = vi.fn()
const mockOnHttpRequestCancelled = vi.fn()
const mockSendHttpResponse = vi.fn()

;(globalThis as any).window = {
  electronAPI: {
    onHttpRequest: mockOnHttpRequest,
    onHttpRequestCancelled: mockOnHttpRequestCancelled,
    sendHttpResponse: mockSendHttpResponse,
    removeHttpRequestListener: vi.fn()
  }
}

const ROOT = path.resolve(__dirname, '..')
const T = 'ab'.repeat(32)
const K = '02' + 'cd'.repeat(32)
const ID = `${'ef'.repeat(32)}_0`
const COLOR_BASKET = `p color ${'a'.repeat(64)}v0`

class AttestationEvidenceError extends Error {
  name = 'AttestationEvidenceError'
  constructor (readonly reason: string) {
    super(`[AttestationEvidenceError] BRC-207: attested evidence rejected (${reason})`)
  }
}

class ColorProviderError extends Error {
  name = 'ColorProviderError'
  constructor (readonly code: string, readonly retryable: boolean, readonly transport: boolean, m: string) {
    super(m)
  }
}

function atomicBeef (): number[] {
  const source = new Transaction()
  source.addOutput({ lockingScript: LockingScript.fromHex('51'), satoshis: 2000 })
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
  tx.addOutput({ lockingScript: LockingScript.fromHex('51'), satoshis: 1000 })
  return tx.toAtomicBEEF()
}

function makeMockWallet (overrides: Record<string, any> = {}): any {
  const methods = [
    'isAuthenticated', 'getVersion', 'getNetwork', 'getPublicKey', 'listActions', 'listOutputs',
    'createAction', 'signAction', 'abortAction', 'internalizeAction', 'relinquishOutput',
    'revealCounterpartyKeyLinkage', 'revealSpecificKeyLinkage', 'encrypt', 'decrypt', 'createHmac',
    'verifyHmac', 'createSignature', 'verifySignature', 'acquireCertificate', 'listCertificates',
    'proveCertificate', 'relinquishCertificate', 'discoverByIdentityKey', 'discoverByAttributes',
    'waitForAuthentication', 'getHeight', 'getHeaderForHeight'
  ]
  const wallet: Record<string, any> = {}
  for (const m of methods) wallet[m] = vi.fn()
  return Object.assign(wallet, overrides)
}

type Bridge = (path: string, body: string, headers?: Record<string, string>) => Promise<{ status: number, body: string }>

let bridgeErrorBody: typeof import('../src/onWalletReady').bridgeErrorBody
let nextRequestId = 1

/** Register the onWalletReady listener for `wallet` and return a request driver. */
async function harness (wallet: any): Promise<Bridge> {
  const mod = await import('../src/onWalletReady')
  bridgeErrorBody = mod.bridgeErrorBody
  mod._test_reset()
  await mod.onWalletReady(wallet)
  const handler = mockOnHttpRequest.mock.calls[mockOnHttpRequest.mock.calls.length - 1][0]
  return async (reqPath, body, headers = { origin: 'http://app.example' }) => {
    const requestId = nextRequestId++
    await handler({ method: 'POST', path: reqPath, headers, body, request_id: requestId })
    const sent = mockSendHttpResponse.mock.calls.map(c => c[0]).find(r => r.request_id === requestId)
    if (sent == null) throw new Error('no response sent for request ' + requestId)
    return { status: sent.status, body: sent.body }
  }
}

beforeEach(async () => {
  vi.resetModules()
  mockOnHttpRequest.mockReset()
  mockOnHttpRequestCancelled.mockReset()
  mockSendHttpResponse.mockReset()
  bridgeErrorBody = (await import('../src/onWalletReady')).bridgeErrorBody
})

describe('large receipts and hand-over evidence (D4, D29, D30)', () => {
  test('the BRC-100 HTTP body limit stays at least 32 MiB', () => {
    expect(HTTP_JSON_BODY_LIMIT).toBe('50mb')
    const src = fs.readFileSync(path.join(ROOT, 'electron/httpServer.ts'), 'utf8')
    expect(src).toMatch(/express\.json\(\{ limit: HTTP_JSON_BODY_LIMIT \}\)/)
    expect(src).toMatch(/express\.text\(\{ type: '\*\/\*', limit: HTTP_JSON_BODY_LIMIT \}\)/)
    expect(src).not.toMatch(/limit: '50mb'/)
  })

  test('colorHandoff survives the bridge round trip', () => {
    const result = {
      txid: T,
      tx: [1, 2, 3],
      colorHandoff: {
        version: 1,
        txid: T,
        profileData: {
          'https://brc.dev/207/attested': {
            [ID]: {
              declarationTx: '0100',
              transactions: ['0a0b'],
              attestations: [{ txid: T, outputs: [0], signer: K, signature: '3045' }],
              submissions: [{ txid: T, offChainValues: '7b7d' }]
            }
          }
        }
      }
    }
    expect(parseWalletPayload(stringifyWalletPayload(result))).toEqual(result)
  })

  test('a signAction colorHandoff reaches the HTTP client unchanged', async () => {
    const colorHandoff = {
      version: 1,
      txid: T,
      profileData: { 'https://brc.dev/207/attested': { [ID]: { declarationTx: '0100', transactions: [], attestations: [{ txid: T, outputs: [0], signer: K, signature: '3045' }], submissions: [] } } }
    }
    const wallet = makeMockWallet({ signAction: vi.fn().mockResolvedValue({ txid: T, tx: [1, 2, 3], colorHandoff }) })
    const send = await harness(wallet)
    const res = await send('/signAction', stringifyWalletPayload({ reference: 'cmVm', spends: {} }))
    expect(res.status).toBe(200)
    expect(parseWalletPayload<any>(res.body).colorHandoff).toEqual(colorHandoff)
  })

  test('a 16 MiB receipt reaches internalizeAction unchanged', async () => {
    const customInstructions = 'x'.repeat(16 * 1024 * 1024 + 10)
    const wallet = makeMockWallet({ internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) })
    const send = await harness(wallet)
    const res = await send('/internalizeAction', stringifyWalletPayload({
      tx: [1, 2, 3],
      outputs: [{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: COLOR_BASKET, customInstructions } }],
      description: 'Receive tokens'
    }))
    expect(res.status).toBe(200)
    expect(wallet.internalizeAction).toHaveBeenCalledOnce()
    const [args, origin] = wallet.internalizeAction.mock.calls[0]
    expect(origin).toBe('app.example')
    expect(args.outputs[0].insertionRemittance.customInstructions.length).toBe(16777226)
    expect(args.outputs[0].insertionRemittance.customInstructions === customInstructions).toBe(true)
  })

  test('routes a 2 MiB p color receipt through the manager to the module', async () => {
    const customInstructions = 'y'.repeat(2 * 1024 * 1024)
    const seen: number[] = []
    const color = {
      onRequest: vi.fn(async (r: any) => {
        seen.push(r.args.outputs[0].insertionRemittance.customInstructions.length)
        return { args: r.args }
      }),
      onResponse: vi.fn(async (r: any) => r)
    }
    const underlying = { internalizeAction: vi.fn().mockResolvedValue({ accepted: true }) }
    const pm = new WalletPermissionsManager(underlying as unknown as WalletInterface, 'admin.local', {
      encryptWalletMetadata: false,
      permissionModules: { color }
    } as any)
    const result = await pm.internalizeAction({
      tx: atomicBeef(),
      outputs: [{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: COLOR_BASKET, customInstructions } }],
      description: 'Receive tokens'
    }, 'app.example')
    expect(result).toEqual({ accepted: true })
    expect(color.onRequest).toHaveBeenCalledOnce()
    expect(color.onRequest.mock.calls[0][0].method).toBe('internalizeAction')
    expect(color.onRequest.mock.calls[0][0].originator).toBe('app.example')
    expect(seen).toEqual([2 * 1024 * 1024])
    expect(underlying.internalizeAction).toHaveBeenCalledOnce()
  })
})

describe('typed errors through the HTTP bridge (D22, contract §8.2)', () => {
  test('forwards the error name and typed fields', async () => {
    const providerError = new ColorProviderError('ERR_UNAVAILABLE', true, true, '[ColorProviderError] mandala overlay refused (ERR_UNAVAILABLE, retryable): down')
    const wallet = makeMockWallet({
      internalizeAction: vi.fn().mockRejectedValue(new AttestationEvidenceError('frontier')),
      createAction: vi.fn().mockRejectedValue(providerError)
    })
    const send = await harness(wallet)
    const res = await send('/internalizeAction', stringifyWalletPayload({ tx: [1], outputs: [], description: 'Receive tokens' }))
    expect(res.status).toBe(400)
    expect(parseWalletPayload(res.body)).toEqual({
      message: '[AttestationEvidenceError] BRC-207: attested evidence rejected (frontier)',
      name: 'AttestationEvidenceError'
    })
    const res2 = await send('/createAction', stringifyWalletPayload({ description: 'Send tokens' }))
    expect(res2.status).toBe(400)
    expect(parseWalletPayload(res2.body)).toEqual({
      message: '[ColorProviderError] mandala overlay refused (ERR_UNAVAILABLE, retryable): down',
      name: 'ColorProviderError',
      code: 'ERR_UNAVAILABLE',
      retryable: true,
      transport: true
    })
    expect(res.body).not.toMatch(/isError/)
    expect(res2.body).not.toMatch(/isError/)
  })

  test('a retry and concurrent failures yield identical, independent bodies', async () => {
    const wallet = makeMockWallet({
      internalizeAction: vi.fn().mockRejectedValue(new AttestationEvidenceError('frontier')),
      listOutputs: vi.fn().mockRejectedValue(new ColorProviderError('ERR_TIMEOUT', true, true, '[ColorProviderError] t'))
    })
    const send = await harness(wallet)
    const [a, b, c] = await Promise.all([
      send('/internalizeAction', '{}'),
      send('/listOutputs', '{}'),
      send('/internalizeAction', '{}')
    ])
    expect(a).toEqual(c)
    expect(parseWalletPayload(b.body)).toEqual({ message: '[ColorProviderError] t', name: 'ColorProviderError', code: 'ERR_TIMEOUT', retryable: true, transport: true })
    const retry = await send('/internalizeAction', '{}')
    expect(retry).toEqual(a)
  })

  test('bridgeErrorBody never copies isError, stacks or non-typed fields', () => {
    const e = Object.assign(new Error('x'), { isError: true, code: 7, retryable: 'yes', stack: 's', cause: 'c' })
    expect(bridgeErrorBody(e)).toEqual({ message: 'x', name: 'Error' })
    expect(bridgeErrorBody('boom')).toEqual({ message: 'boom' })
    expect(bridgeErrorBody(undefined)).toEqual({ message: 'undefined' })
  })

  test('bridgeErrorBody reads name as a property, never constructor.name (minified builds)', () => {
    // A minified class: constructor.name is mangled, the explicit name field survives.
    const Mangled = class a extends Error { name = 'AttestationEvidenceError' }
    expect(bridgeErrorBody(new Mangled('[AttestationEvidenceError] m'))).toEqual({ message: '[AttestationEvidenceError] m', name: 'AttestationEvidenceError' })
    // An inherited name (prototype) is forwarded too.
    class Proto extends Error {}
    ;(Proto.prototype as any).name = 'ProfileDataError'
    expect(bridgeErrorBody(new Proto('[ProfileDataError] p'))).toEqual({ message: '[ProfileDataError] p', name: 'ProfileDataError' })
    // An empty or non-string name is dropped, never replaced by constructor.name.
    const noName = Object.assign(new Mangled('m'), { name: '' })
    expect(bridgeErrorBody(noName)).toEqual({ message: 'm' })
    const numName = Object.assign(new Error('n'), { name: 5 })
    expect(bridgeErrorBody(numName)).toEqual({ message: 'n' })
  })

  test('bridgeErrorBody never throws on hostile error properties', () => {
    const e = new Error('h')
    Object.defineProperty(e, 'name', { get () { throw new Error('getter') } })
    Object.defineProperty(e, 'code', { get () { throw new Error('getter') } })
    expect(bridgeErrorBody(e)).toEqual({ message: 'h' })
  })

  test('no generic { message } error path remains', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/onWalletReady.ts'), 'utf8')
    expect(src).not.toMatch(/message: error instanceof Error \? error\.message : String\(error\)/)
    expect(src.match(/bridgeErrorBody\(/g)!.length).toBeGreaterThanOrEqual(20)
  })

  // CG-DESK-ERR: sdk HTTPWalletJSON drops non-envelope error bodies.
  // The vendored sdk 4.0.0 client turns any 400 body without `isError` into
  // `Error('HTTPWalletJSON <call> failed with HTTP status 400')`, so `name`
  // and `message` are lost on the client side. Once the sdk rebuilds the
  // error from `{ message, name, code?, retryable?, transport? }`, this test
  // passes and `test.fails` turns red: drop the marker then.
  test.fails('the name reaches an HTTPWalletJSON client (CG-DESK-ERR)', async () => {
    const wallet = makeMockWallet({
      internalizeAction: vi.fn().mockRejectedValue(new AttestationEvidenceError('frontier'))
    })
    const send = await harness(wallet)
    const fakeFetch = async (url: string, init: any): Promise<Response> => {
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v)
      const res = await send(new URL(url).pathname, init.body, headers)
      return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } })
    }
    const client = new HTTPWalletJSON('app.example', 'http://localhost:3321', fakeFetch as any)
    const err: any = await client.internalizeAction({
      tx: atomicBeef(),
      outputs: [{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: COLOR_BASKET, customInstructions: 'r' } }],
      description: 'Receive tokens'
    }).then(() => undefined, (e: unknown) => e)
    expect(wallet.internalizeAction).toHaveBeenCalledOnce()
    expect(err).toBeInstanceOf(Error)
    expect(err.name === 'AttestationEvidenceError' || String(err.message).startsWith('[AttestationEvidenceError]')).toBe(true)
  })
})
