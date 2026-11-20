/**
 * The sigma permission module as the host builds it, behind a real
 * WalletPermissionsManager, with the real scoped key deriver over a fixed
 * test key.
 *
 * Cases pinned here:
 * - without a key deriver the factory warns once and returns a module that
 *   refuses everything; it never throws;
 * - the user is asked once for the public key (remembered for
 *   SIGMA_KEY_GRANT_MS) and once for every proof, with a message the prompt
 *   can parse, from the requesting app;
 * - an approved OR proof verifies; a denied one returns an error and no proof;
 * - privileged requests and requests for a counterparty other than self are
 *   not supported in this version: they are refused without a prompt;
 * - a missing prompt handler is a denial; a prompt handler that throws fails
 *   the request with its own error, and no key is derived for it;
 * - two concurrent proofs that differ only in key ID, or only in the other
 *   ring member, get a prompt each, and each is decided on its own;
 * - a prompt still open when the module is disposed and its view revoked
 *   yields no proof when it is approved afterwards, and a module built
 *   afterwards serves requests;
 * - dispose is safe on anything.
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { CachedKeyDeriver, Hash, PrivateKey, Utils } from '@bsv/sdk'
import { WalletPermissionsManager } from '@bsv/wallet-toolbox-client'
import { parsePoint33, verifyOr } from '@bsv/sigma-permission-module'
import {
  SIGMA_KEY_GRANT_MS,
  createHostSigmaModule,
  disposeHostSigmaModule
} from '../src/lib/permissionModules/sigma/module'
import { parseSigmaPromptMessage } from '../src/lib/permissionModules/sigma/message'
import { revocableKeyDeriver } from '../src/lib/permissionModules/keyDeriver'
import type { PermissionPromptHandler } from '../src/lib/permissionModules/types'

const APP = 'app.example.com'
const adminOriginator = 'admin.example.com'
const ROOT = new PrivateKey('3d5f8c2a91b04e67d1a8f0c4b2e9d7a6c5b4a39281706f5e4d3c2b1a09f8e7d6', 16)
const OTHER = new PrivateKey(7).toPublicKey().encode(true) as number[]
const CTX = Array.from(Utils.toArray('spuzzle round 1', 'utf8'))
const CTX2 = Array.from(Utils.toArray('spuzzle round 2', 'utf8'))

/** An underlying wallet that throws on every call: the module must never reach it. */
const wallet = new Proxy({}, {
  get: (_target, prop) => {
    if (typeof prop !== 'string' || prop === 'then') return undefined
    return () => { throw new Error(`underlying wallet ${prop} must not be called`) }
  }
}) as any

const next = vi.fn(async () => { throw new Error('next must not be called') })

const scopedDeriver = () => revocableKeyDeriver(new CachedKeyDeriver(ROOT), 'p sigma ').deriver

function manager (prompt?: PermissionPromptHandler, keyDeriver = scopedDeriver()) {
  return new WalletPermissionsManager(wallet, adminOriginator, {
    encryptWalletMetadata: false,
    permissionModules: {
      sigma: createHostSigmaModule({ wallet, adminOriginator, promptHandler: prompt, keyDeriver }) as any
    }
  } as any)
}

type Extra = { counterparty?: string, privileged?: boolean, privilegedReason?: string, level?: 0 | 1 | 2 }

const requestKey = (pm: WalletPermissionsManager, extra: Extra = {}) => pm.encrypt({
  protocolID: [extra.level ?? 1, 'p sigma key spuzzle payout'],
  keyID: 'member 1',
  counterparty: extra.counterparty ?? 'self',
  plaintext: [],
  ...(extra.privileged ? { privileged: true, privilegedReason: extra.privilegedReason } : {})
} as any, APP)

const requestOr = (pm: WalletPermissionsManager, ctx = CTX, keyID = 'member 1', other = OTHER) => pm.encrypt({
  protocolID: [1, 'p sigma or spuzzle payout'],
  keyID,
  counterparty: 'self',
  plaintext: [2, 1, ...other, ...ctx]
} as any, APP)

afterEach(() => {
  vi.restoreAllMocks()
})

test('without a key deriver the module refuses and the factory does not throw', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const m = createHostSigmaModule({ wallet, adminOriginator }) as any
  expect(warn).toHaveBeenCalledOnce()
  await expect(m.handleRequest({ method: 'encrypt', originator: APP, args: {} }, next))
    .rejects.toThrow('Sigma proofs are unavailable in this wallet')
  await expect(m.onRequest({ method: 'encrypt', originator: APP, args: {} }))
    .rejects.toThrow('Sigma proofs are unavailable in this wallet')
  await expect(m.onResponse({}, { method: 'encrypt', originator: APP }))
    .rejects.toThrow('Sigma proofs are unavailable in this wallet')
  expect(next).not.toHaveBeenCalled()
})

test('a key deriver the module cannot use gives the refusing module, not a throw', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  let m: any
  expect(() => { m = createHostSigmaModule({ wallet, adminOriginator, keyDeriver: {} as any }) }).not.toThrow()
  expect(warn).toHaveBeenCalledOnce()
  await expect(m.handleRequest({ method: 'encrypt', originator: APP, args: {} }, next))
    .rejects.toThrow('Sigma proofs are unavailable in this wallet')
})

test('asks once for the public key and once for every proof', async () => {
  const prompt = vi.fn(async () => true)
  const pm = manager(prompt)
  await requestKey(pm)
  await requestOr(pm)
  await requestOr(pm)
  await requestKey(pm)
  expect(prompt.mock.calls.map(c => parseSigmaPromptMessage(c[1])!.operation)).toEqual(['key', 'or', 'or'])
  expect(prompt.mock.calls.every(c => c[0] === APP)).toBe(true)
})

test('the prompt is told what the proof covers', async () => {
  const prompt = vi.fn(async () => true)
  const pm = manager(prompt)
  await requestOr(pm, CTX2)
  const input = [2, 1, ...OTHER, ...CTX2]
  expect(parseSigmaPromptMessage(prompt.mock.calls[0][1])).toEqual({
    operation: 'or',
    applicationBase: false,
    securityLevel: 1,
    logicalProtocolID: 'spuzzle payout',
    keyID: 'member 1',
    counterparty: 'self',
    contextSha256: Utils.toHex(Hash.sha256(CTX2)),
    inputSha256: Utils.toHex(Hash.sha256(input))
  })
})

test('a public-key approval lasts SIGMA_KEY_GRANT_MS', async () => {
  expect(SIGMA_KEY_GRANT_MS).toBe(30 * 60 * 1000)
  let now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const prompt = vi.fn(async () => true)
  const pm = manager(prompt)
  await requestKey(pm)
  now += SIGMA_KEY_GRANT_MS - 1
  await requestKey(pm)
  expect(prompt).toHaveBeenCalledTimes(1)
  now += 1
  await requestKey(pm)
  expect(prompt).toHaveBeenCalledTimes(2)
})

test('an approved or proof verifies', async () => {
  const pm = manager(vi.fn(async () => true))
  const P = parsePoint33((await requestKey(pm)).ciphertext, 'P')
  const other = parsePoint33(OTHER, 'other')
  const proof = (await requestOr(pm)).ciphertext
  expect(verifyOr([P, other], CTX, proof)).toBe(true)
  expect(verifyOr([P, other], CTX2, proof)).toBe(false)
})

test('a denied proof returns an error and no proof', async () => {
  const prompt = vi.fn(async (_app: string, message: string) => parseSigmaPromptMessage(message)!.operation === 'key')
  const pm = manager(prompt)
  await requestKey(pm)
  await expect(requestOr(pm)).rejects.toThrow(/denied/)
  expect(prompt).toHaveBeenCalledTimes(2)
})

describe('privileged requests and requests for a counterparty other than self are not supported in this version', () => {
  // The host's own refusal, distinct from the key deriver's error for the same case.
  const NOT_SUPPORTED = 'Sigma: privileged requests and requests for a counterparty other than self are not supported in this version'
  const PUB = new PrivateKey(11).toPublicKey().toString()

  test('a privileged request is refused without a prompt', async () => {
    const prompt = vi.fn(async () => true)
    const pm = manager(prompt)
    await expect(requestKey(pm, { privileged: true, privilegedReason: 'testing privileged' })).rejects.toThrow(NOT_SUPPORTED)
    expect(prompt).not.toHaveBeenCalled()
  })

  test.each([
    ['anyone', 'anyone'],
    ['a compressed public key', PUB]
  ])('a request for counterparty %s is refused without a prompt', async (_name, counterparty) => {
    const prompt = vi.fn(async () => true)
    for (const level of [1, 2] as const) {
      const pm = manager(prompt)
      await expect(requestKey(pm, { counterparty, level })).rejects.toThrow(NOT_SUPPORTED)
    }
    expect(prompt).not.toHaveBeenCalled()
  })

  test('a remembered self key approval does not let a request for anyone through', async () => {
    const prompt = vi.fn(async () => true)
    const pm = manager(prompt)
    await requestKey(pm)
    expect(prompt).toHaveBeenCalledTimes(1)
    await expect(requestKey(pm, { counterparty: 'anyone' })).rejects.toThrow(NOT_SUPPORTED)
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test('at level 0 a request for another counterparty is refused before any key is derived', async () => {
    const prompt = vi.fn(async () => true)
    const source = new CachedKeyDeriver(ROOT)
    const derive = vi.spyOn(source, 'derivePrivateKey')
    const pm = manager(prompt, revocableKeyDeriver(source, 'p sigma ').deriver)
    await expect(requestKey(pm, { counterparty: PUB, level: 0 })).rejects.toThrow(NOT_SUPPORTED)
    expect(derive).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    // The same deriver still serves self at level 0, so the spy is live.
    await requestKey(pm, { level: 0 })
    expect(derive).toHaveBeenCalledOnce()
  })

  test('an absent counterparty means self', async () => {
    const prompt = vi.fn(async () => true)
    const pm = manager(prompt)
    const result = await pm.encrypt({ protocolID: [1, 'p sigma key spuzzle payout'], keyID: 'member 1', plaintext: [] } as any, APP)
    expect(result.ciphertext).toHaveLength(33)
    expect(prompt).toHaveBeenCalledOnce()
  })

  test('authorize itself refuses them without a prompt when the host check is passed', async () => {
    // Arguments whose property reads say self and not privileged, while their
    // own data (which the module copies) says otherwise: the host check passes
    // and the module asks authorize, which still refuses.
    const prompt = vi.fn(async () => true)
    const pm = manager(prompt)
    const twoFaced = (args: Record<string, unknown>, shown: Record<string, unknown>) =>
      new Proxy(args, { get: (target, prop) => (prop in shown ? shown[prop as string] : Reflect.get(target, prop)) })
    const key = { protocolID: [1, 'p sigma key spuzzle payout'], keyID: 'member 1', plaintext: [] }
    await expect(pm.encrypt(twoFaced({ ...key, counterparty: 'anyone' }, { counterparty: 'self' }) as any, APP))
      .rejects.toThrow(/denied/)
    await expect(pm.encrypt(twoFaced({ ...key, counterparty: 'self', privileged: true, privilegedReason: 'testing privileged' },
      { privileged: false }) as any, APP)).rejects.toThrow(/denied/)
    expect(prompt).not.toHaveBeenCalled()
  })
})

test('a missing prompt handler is a denial', async () => {
  const pm = manager(undefined)
  await expect(requestKey(pm)).rejects.toThrow(/denied/)
})

test('a prompt handler that throws fails the request with its error, and no key is derived for it', async () => {
  const source = new CachedKeyDeriver(ROOT)
  const derive = vi.spyOn(source, 'derivePrivateKey')
  const prompt = vi.fn(async () => { throw new Error('prompt failed') })
  const pm = manager(prompt, revocableKeyDeriver(source, 'p sigma ').deriver)
  let result: unknown
  await expect(requestOr(pm).then(r => { result = r })).rejects.toThrow('prompt failed')
  expect(result).toBeUndefined()
  expect(prompt).toHaveBeenCalledOnce()
  expect(derive).not.toHaveBeenCalled()
})

test('a prompt that answers anything but true is a denial', async () => {
  const pm = manager(vi.fn(async () => 'yes' as any))
  await expect(requestKey(pm)).rejects.toThrow(/denied/)
})

test('dispose is safe on anything', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const throwing = { dispose: () => { throw new Error('boom') } }
  for (const x of [undefined, null, {}, 1, 'x', throwing, createHostSigmaModule({ wallet, adminOriginator })])
    expect(() => disposeHostSigmaModule(x)).not.toThrow()
  expect(error).toHaveBeenCalledOnce()
})

test('a disposed module refuses later requests without a prompt', async () => {
  const prompt = vi.fn(async () => true)
  const sigma = createHostSigmaModule({ wallet, adminOriginator, promptHandler: prompt, keyDeriver: scopedDeriver() })
  const pm = new WalletPermissionsManager(wallet, adminOriginator, {
    encryptWalletMetadata: false,
    permissionModules: { sigma }
  } as any)
  disposeHostSigmaModule(sigma)
  await expect(requestKey(pm)).rejects.toThrow(/disposed/)
  expect(prompt).not.toHaveBeenCalled()
})

/** Lets every pending promise callback run. */
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0)) }

/** A prompt handler that leaves every prompt open until the test answers it. */
function openPrompts () {
  const open: Array<{ message: string, answer: (allowed: boolean) => void }> = []
  const prompt = vi.fn((_app: string, message: string) => new Promise<boolean>(answer => { open.push({ message, answer }) }))
  return { open, prompt }
}

/** The outcome of a request so far: 'pending', its ciphertext, or its error. */
function track (request: Promise<{ ciphertext: number[] }>) {
  const outcome: { state: 'pending' | 'proof' | 'error', ciphertext?: number[], error?: Error } = { state: 'pending' }
  request.then(r => { outcome.state = 'proof'; outcome.ciphertext = r.ciphertext }, (e: Error) => { outcome.state = 'error'; outcome.error = e })
  return outcome
}

/** The wallet's public key for `keyID`, from a separate manager that approves everything. */
const publicKey = async (keyID: string) => parsePoint33((await manager(async () => true).encrypt({
  protocolID: [1, 'p sigma key spuzzle payout'], keyID, counterparty: 'self', plaintext: []
} as any, APP)).ciphertext, 'P')

const OTHER_B = new PrivateKey(8).toPublicKey().encode(true) as number[]

describe('two concurrent proofs that differ in one field', () => {
  test.each([
    ['key ID', ['member 1', OTHER], ['member 2', OTHER]],
    ['the other ring member', ['member 1', OTHER], ['member 1', OTHER_B]]
  ] as const)('differing only in %s, each gets its own prompt and its own decision', async (_field, first, second) => {
    const source = new CachedKeyDeriver(ROOT)
    const derive = vi.spyOn(source, 'derivePrivateKey')
    const { open, prompt } = openPrompts()
    const pm = manager(prompt, revocableKeyDeriver(source, 'p sigma ').deriver)
    const a = track(requestOr(pm, CTX, first[0], [...first[1]]))
    const b = track(requestOr(pm, CTX, second[0], [...second[1]]))
    await settle()
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(open[0].message).not.toBe(open[1].message)
    expect(open.map(o => parseSigmaPromptMessage(o.message)!.operation)).toEqual(['or', 'or'])

    open[0].answer(true)
    await settle()
    expect(a.state).toBe('proof')
    expect(b.state).toBe('pending')
    expect(derive).toHaveBeenCalledTimes(1)
    expect(verifyOr([await publicKey(first[0]), parsePoint33([...first[1]], 'other')], CTX, a.ciphertext!)).toBe(true)

    open[1].answer(false)
    await settle()
    expect(b.state).toBe('error')
    expect(b.error!.message).toMatch(/denied/)
    expect(b.ciphertext).toBeUndefined()
    expect(derive).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledTimes(2)
  })
})

test('a prompt still open when the wallet closes yields nothing when approved afterwards; a new module serves requests', async () => {
  const source = new CachedKeyDeriver(ROOT)
  const derive = vi.spyOn(source, 'derivePrivateKey')
  const { open, prompt } = openPrompts()
  const view = revocableKeyDeriver(source, 'p sigma ')
  const sigma = createHostSigmaModule({ wallet, adminOriginator, promptHandler: prompt, keyDeriver: view.deriver })
  const pm = new WalletPermissionsManager(wallet, adminOriginator, {
    encryptWalletMetadata: false,
    permissionModules: { sigma }
  } as any)
  const stale = track(requestOr(pm))
  await settle()
  expect(open).toHaveLength(1)

  // As a wallet close does: the module is disposed and its view revoked.
  disposeHostSigmaModule(sigma)
  view.revoke()
  await settle()
  open[0].answer(true)
  await settle()
  expect(stale.state).toBe('error')
  expect(stale.ciphertext).toBeUndefined()
  expect(derive).not.toHaveBeenCalled()

  const fresh = revocableKeyDeriver(source, 'p sigma ')
  const approve = vi.fn(async () => true)
  const next = new WalletPermissionsManager(wallet, adminOriginator, {
    encryptWalletMetadata: false,
    permissionModules: { sigma: createHostSigmaModule({ wallet, adminOriginator, promptHandler: approve, keyDeriver: fresh.deriver }) }
  } as any)
  const P = parsePoint33((await requestKey(next)).ciphertext, 'P')
  const proof = (await requestOr(next)).ciphertext
  expect(verifyOr([P, parsePoint33(OTHER, 'other')], CTX, proof)).toBe(true)
  expect(approve).toHaveBeenCalledTimes(2)
})
