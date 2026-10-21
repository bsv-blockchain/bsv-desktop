import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CachedKeyDeriver, PrivateKey, Utils, validateWalletResult } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'
import { RabinPermissionModule, decodeKeyResult, decodeSignResult, verify } from '@bsv/rabin-permission-module'

vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
// The published BTMS UI uses extensionless ESM imports resolved by Vite's
// renderer bundler. Keep that renderer-only component out of the Node test.
vi.mock('@bsv/btms-permission-module-ui', () => ({ BtmsPermissionPrompt: () => null }))

import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'
import { buildPermissionModuleRegistry } from '../src/lib/permissionModules/registry'
import { rabinPermissionModule } from '../src/lib/permissionModules/rabin'
import { mandalaPermissionModule } from '../src/lib/permissionModules/mandala'
import { btmsPermissionModule } from '../src/lib/permissionModules/btms'
import { displayText, parseRabinPromptMessage, rabinPromptCopy, toRabinPromptMessage } from '../src/lib/permissionModules/rabin/promptMessage'
import type { PermissionModuleDefinition } from '../src/lib/permissionModules/types'
import { parseWalletPayload, stringifyWalletPayload } from '../src/walletByteJson'

const ADMIN = 'desktop-admin.example.com'
const APP = 'oracle.example.com'
// BRC-206 conformance vector K1 (wallet root 2, level 2, "example oracle", key "feed 1")
// and S1 (same key, message "abc").
const WALLET_A = '0000000000000000000000000000000000000000000000000000000000000002'
const K1_N = 'cec26a0c8b9802e9f1a9a75615509f1b7a1de78f5ee03c822e05615b2472b67f3a2d7d667da096940596b215f8f6a1caab123d8c1e6217e799ac3c552c648aa2d0d17ed5d4fcf1cbb5fab897f5e863ee4d20f631ba7ae3c9de726342d6087457ef5cd3b80251e84b8723a37fda9babe5485dd2580dd24de9dfc055f44c778f2ba635e835a5ccfc1b27fed22cfea951153341156dadcf32c5f3bbb36763bcebb6fdcbf93bf098cf0c5a0132f39acc38f91a1e9ccb5f75abc660d8eda6e9fc446f889eceb770047c742a62e20e20d0998cf22e24f8f510da5eba6728935b00ee5056c5dd1f6e9a1d66bc57bfa9093755356834155f34c02a6f33bcf11c0c973601'
const K1_RESULT = '01010136970c1cf1bc336f2ac0345f15346835553709a9bf57bc661d9a6e1fddc55650ee005b932867ba5eda10f5f8242ef28c99d0200ee2622a747c0470b7ce9e886f44fce9a6edd860c6ab755fcb9c1e1af938cc9af332015a0ccf98f03bf9cbfdb6ebbc6367b3bbf3c532cfad6d1541331551a9fe2cd2fe271bfccca535e835a62b8f774cf455c0dfe94dd20d58d25d48e5ab9bda7fa323874be85102b8d35cef577408d6426372dec9e37aba31f6204dee63e8f597b8fab5cbf1fcd4d57ed1d0a28a642c553cac99e717621e8c3d12abcaa1f6f815b296059496a07d667d2d3a7fb672245b61052e823ce05e8fe71d7a1b9f501556a7a9f1e902988b0c6ac2ce00'
const S1_RESULT = '0001aa7034f633b00a326dc55fc7cf1b45f5553f55d0ab0011c6fc7f60b58816b0f908002881156b2ebf573db5f9c129cdda4353a7661eb1312d2e067f259702498184bf715555609d45cf80a5d2b17c0112e3eeb302462f3674c055d97dee7fec42fea7cb04e400cbcbbea24e57dd1e52166f3430ea928e8e51badf81752d7150d6ed5591130a0be2a027296526be211fb4913f7d6c31468e7275efca9a46d7b5fa15857763fdeebc98011a231227483fbf42a8f141ff3a77969b6c97d2d511aaf45ae146eaf1dfbe3d28a74039298f9b0c296602d7d28f1a624405f9a6ae5d6a7640cee4dbd5efcbd803798596617f8f2abe21ec962233542dc870fb6e9ee2cf1d010002'
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

const request = (operation: 'key' | 'sign', overrides: Record<string, unknown> = {}) => ({
  protocolID: [2, `p rabin ${operation} 2048 example oracle`] as [2, string],
  keyID: 'feed 1',
  counterparty: 'self',
  plaintext: operation === 'sign' ? [0x61, 0x62, 0x63] : [],
  ...overrides
})

/** A toolbox-Wallet-shaped object whose every BRC-100 method fails if reached, and its key deriver. */
function makeWallet(withKeyDeriver = true) {
  const deriver = new CachedKeyDeriver(new PrivateKey(WALLET_A, 'hex'))
  const derivePrivateKey = vi.spyOn(deriver, 'derivePrivateKey')
  const reached = vi.fn()
  const fail = (method: string) => async () => {
    reached(method)
    throw new Error(`underlying ${method} must not be called`)
  }
  const wallet = {
    encrypt: fail('encrypt'),
    decrypt: fail('decrypt'),
    getPublicKey: fail('getPublicKey'),
    createSignature: fail('createSignature'),
    verifySignature: fail('verifySignature'),
    createHmac: fail('createHmac'),
    verifyHmac: fail('verifyHmac')
  } as unknown as WalletInterface
  return { wallet, keyDeriver: withKeyDeriver ? deriver : undefined, derivePrivateKey, reached }
}

type TestWallet = ReturnType<typeof makeWallet>

function createManager(
  { wallet, keyDeriver }: Pick<TestWallet, 'wallet' | 'keyDeriver'>,
  approve: ((app: string, message: string) => Promise<boolean>) | null = vi.fn(async () => true),
  modules: PermissionModuleDefinition[] = [rabinPermissionModule]
) {
  const queue = new PermissionQueueManager()
  queue.adminOriginator = ADMIN
  queue.permissionsConfig = { encryptWalletMetadata: false } as any
  queue.enabledPermissionModules = modules.map(module => module.id)
  const registry = buildPermissionModuleRegistry(modules)
  queue.setPermissionsModuleHelpers(registry.getPermissionModuleById, new Map(approve ? [['rabin', approve]] : []))
  return { manager: queue.createPermissionsManager(wallet, keyDeriver), queue }
}

beforeEach(() => vi.stubGlobal('window', {}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('desktop p rabin permissions factory', () => {
  it('routes p rabin encrypt to the module through the installed toolbox and returns the K1 and S1 vector bytes', async () => {
    const handleRequest = vi.spyOn(RabinPermissionModule.prototype, 'handleRequest')
    const testWallet = makeWallet()
    const { derivePrivateKey, reached } = testWallet
    const approve = vi.fn(async () => true)
    const { manager } = createManager(testWallet, approve)

    const key = await manager.encrypt(request('key'), APP)
    const signed = await manager.encrypt(request('sign'), APP)

    expect(handleRequest).toHaveBeenCalledTimes(2)
    expect(Utils.toHex(key.ciphertext)).toBe(K1_RESULT)
    expect(Utils.toHex(signed.ciphertext)).toBe(S1_RESULT)
    expect(decodeKeyResult(key.ciphertext)).toBe(BigInt(`0x${K1_N}`))
    const { sig, padding } = decodeSignResult(signed.ciphertext)
    expect(verify([0x61, 0x62, 0x63], sig, padding, BigInt(`0x${K1_N}`))).toBe(true)
    expect(derivePrivateKey).toHaveBeenCalledTimes(1)
    expect(derivePrivateKey).toHaveBeenCalledWith([2, 'p rabin example oracle'], 'feed 1', 'self')
    expect(reached).not.toHaveBeenCalled()

    // One level-2 approval covers the protocol for this app and counterparty.
    expect(approve).toHaveBeenCalledTimes(1)
    expect(approve.mock.calls[0][0]).toBe(APP)
    expect(JSON.parse(approve.mock.calls[0][1])).toEqual({
      type: 'rabin_key',
      originator: APP,
      securityLevel: 2,
      logicalProtocolID: 'example oracle',
      keyID: 'feed 1',
      counterparty: 'self',
      bits: 2048
    })
  })

  it('shows the message size and SHA-256 when the first request is a signature', async () => {
    const approve = vi.fn(async () => true)
    const { manager } = createManager(makeWallet(), approve)
    await manager.encrypt(request('sign'), APP)
    const message = parseRabinPromptMessage(approve.mock.calls[0][1])
    expect(message).toMatchObject({ type: 'rabin_sign', messageLength: 3, messageSha256: ABC_SHA256 })
  })

  it('runs level 0 without a prompt and fails closed when the wallet exposes no key deriver', async () => {
    const approve = vi.fn(async () => true)
    const { manager } = createManager(makeWallet(true), approve)
    await expect(manager.encrypt(request('key', { protocolID: [0, 'p rabin key 2048 example oracle'] }), APP)).resolves.toHaveProperty('ciphertext')
    // No first-use prompt for level-0 generation or signing (BRC-206; the module's rate limits bound the CPU).
    await expect(manager.encrypt(request('sign', { protocolID: [0, 'p rabin sign 2048 example oracle'] }), APP)).resolves.toHaveProperty('ciphertext')
    await expect(manager.encrypt(request('key', { protocolID: [0, 'p rabin key 2048 example oracle'], keyID: 'fresh key' }), APP)).resolves.toHaveProperty('ciphertext')
    expect(approve).not.toHaveBeenCalled()

    const { manager: withoutDeriver } = createManager(makeWallet(false), approve)
    await expect(withoutDeriver.encrypt(request('key', { protocolID: [0, 'p rabin key 2048 example oracle'] }), APP)).rejects.toThrow('RABIN: key deriver unavailable')
  })

  it('denies without deriving when the user denies or no prompt is registered', async () => {
    const testWallet = makeWallet()
    const { derivePrivateKey } = testWallet
    const deny = vi.fn(async () => false)
    await expect(createManager(testWallet, deny).manager.encrypt(request('sign'), APP)).rejects.toThrow('RABIN: user denied permission')
    await expect(createManager(testWallet, null).manager.encrypt(request('sign'), APP)).rejects.toThrow('RABIN: user denied permission')
    await expect(createManager(testWallet).manager.encrypt(request('sign', { seekPermission: false }), APP)).rejects.toThrow('seekPermission is false')
    expect(deny).toHaveBeenCalledTimes(1)
    expect(derivePrivateKey).not.toHaveBeenCalled()
  })

  it('refuses privileged Rabin keys before prompting', async () => {
    const testWallet = makeWallet()
    const { derivePrivateKey } = testWallet
    const approve = vi.fn(async () => true)
    const { manager } = createManager(testWallet, approve)
    await expect(manager.encrypt(request('key', { privileged: true, privilegedReason: 'Oracle signing' }), APP)).rejects.toThrow('RABIN: privileged key derivation is unavailable')
    expect(approve).not.toHaveBeenCalled()
    expect(derivePrivateKey).not.toHaveBeenCalled()
  })

  it.each([
    ['decrypt', { ciphertext: [1, 2, 3] }],
    ['getPublicKey', {}],
    ['createSignature', { data: [1, 2, 3] }],
    ['verifySignature', { data: [1, 2, 3], signature: [0x30, 0x06, 2, 1, 1, 2, 1, 1] }],
    ['createHmac', { data: [1, 2, 3] }],
    ['verifyHmac', { data: [1, 2, 3], hmac: Array.from({ length: 32 }, () => 0) }]
  ])('rejects %s under p rabin without reaching the wallet', async (method, extra) => {
    const testWallet = makeWallet()
    const { derivePrivateKey, reached } = testWallet
    const { manager } = createManager(testWallet)
    const args = { protocolID: [2, 'p rabin sign 2048 example oracle'], keyID: 'feed 1', counterparty: 'self', ...extra }
    await expect((manager as any)[method](args, APP)).rejects.toThrow(`RABIN: ${method} is not permitted in the p rabin namespace`)
    expect(derivePrivateKey).not.toHaveBeenCalled()
    expect(reached).not.toHaveBeenCalled()
  })

  it('carries the result through the HTTP bridge byte JSON and the SDK result validator', async () => {
    const { manager } = createManager(makeWallet())
    // A browser client may send plaintext as an array or as a numeric-key object.
    const body = JSON.stringify({ ...request('sign'), plaintext: { 0: 0x61, 1: 0x62, 2: 0x63 } })
    const args = parseWalletPayload<any>(body)
    expect(args.plaintext).toEqual([0x61, 0x62, 0x63])
    const response = JSON.parse(stringifyWalletPayload(await manager.encrypt(args, APP)))
    expect(validateWalletResult('encrypt', response)).toEqual(response)
    expect(Utils.toHex(response.ciphertext)).toBe(S1_RESULT)
  })

  it('disposes the modules of a replaced or cleared permissions manager', async () => {
    const dispose = vi.spyOn(RabinPermissionModule.prototype, 'dispose')
    const testWallet = makeWallet()
    const { wallet, keyDeriver, derivePrivateKey } = testWallet
    const { manager, queue } = createManager(testWallet)
    await manager.encrypt(request('key', { protocolID: [0, 'p rabin key 2048 example oracle'] }), APP)
    queue.setPermissionsManager(manager)
    expect(dispose).not.toHaveBeenCalled()

    queue.setPermissionsManager(null)
    expect(dispose).toHaveBeenCalledTimes(1)
    queue.createPermissionsManager(wallet, keyDeriver)
    const rebuilt = queue.createPermissionsManager(wallet, keyDeriver)
    expect(dispose).toHaveBeenCalledTimes(2)
    // A new module starts with an empty key cache.
    await rebuilt.encrypt(request('key', { protocolID: [0, 'p rabin key 2048 example oracle'] }), APP)
    expect(derivePrivateKey).toHaveBeenCalledTimes(2)
  })
})


describe('desktop key deriver scoping', () => {
  it('passes a key deriver only to modules that declare a need, limited to their own scheme', async () => {
    const ordinary = vi.fn(() => ({}))
    let scoped: any
    const probe: PermissionModuleDefinition = {
      id: 'probe',
      label: 'Probe',
      needsKeyDeriver: true,
      createModule: args => {
        scoped = args.keyDeriver
        return {}
      }
    }
    const other: PermissionModuleDefinition = { id: 'other', label: 'Other', createModule: ordinary }
    const testWallet = makeWallet()
    createManager(testWallet, null, [other, probe])

    expect(ordinary).toHaveBeenCalledTimes(1)
    expect(ordinary.mock.calls[0][0]).not.toHaveProperty('keyDeriver')
    expect(scoped).toBeDefined()
    expect(scoped).not.toBe(testWallet.keyDeriver)
    expect(() => scoped.derivePrivateKey([2, 'p probe example'], 'k', 'self')).not.toThrow()
    for (const protocol of ['p rabin example', 'p probex example', 'probe example', '3241645161d8 identity']) {
      expect(() => scoped.derivePrivateKey([2, protocol], 'k', 'self')).toThrow('Key derivation outside p probe is not permitted for the probe module')
    }
    expect(testWallet.derivePrivateKey).toHaveBeenCalledTimes(1)
  })

  it('refuses before prompting when the wallet has no key deriver', async () => {
    const approve = vi.fn(async () => true)
    const { manager } = createManager(makeWallet(false), approve)
    await expect(manager.encrypt(request('key'), APP)).rejects.toThrow('RABIN: key deriver unavailable')
    expect(approve).not.toHaveBeenCalled()
  })
})

describe('desktop Rabin prompt text', () => {
  it('neutralises control and format characters, quotes, and truncates app-supplied text', () => {
    expect(displayText('feed 1')).toBe('“feed 1”')
    expect(displayText('a\u0000b\u202Ec\u200Bd\nE')).toBe('“a\uFFFDb\uFFFDc\uFFFDd\uFFFDE”')
    const long = 'x'.repeat(200)
    expect(displayText(long)).toBe(`“${'x'.repeat(96)}…”`)
    // Truncation counts code points, so a surrogate pair is never split.
    expect(displayText('😀'.repeat(100))).toBe(`“${'😀'.repeat(96)}…”`)
  })

  it('describes the 5-minute grant the same way for key and sign, and states what it covers', () => {
    const key = rabinPromptCopy('oracle.example.com', parseRabinPromptMessage(JSON.stringify(toRabinPromptMessage({
      originator: APP, securityLevel: 2, logicalProtocolID: 'example oracle', keyID: 'feed 1', counterparty: 'self', privileged: false, operation: 'key', bits: 2048
    })))!)
    const sign = rabinPromptCopy('oracle.example.com', parseRabinPromptMessage(JSON.stringify(toRabinPromptMessage({
      originator: APP, securityLevel: 2, logicalProtocolID: 'example oracle', keyID: 'feed 1', counterparty: 'self', privileged: false, operation: 'sign', bits: 2048, messageLength: 3, messageSha256: ABC_SHA256
    })))!)
    const scope = 'If you allow, for the next 5 minutes oracle.example.com can get any “example oracle” key and sign any data with it, without asking again. The private key never leaves your wallet.'
    expect(key.scope).toBe(scope)
    expect(sign.scope).toBe(`${scope} Later signatures in those 5 minutes are not shown.`)
    expect(sign.rows).toContainEqual({ label: 'Fingerprint of this data (SHA-256)', value: ABC_SHA256, mono: true })
    expect(sign.rows).toContainEqual({ label: 'Key name', value: '“feed 1”', mono: true })
    expect(key.rows.map(row => row.label)).not.toContain('Fingerprint of this data (SHA-256)')
  })

  it('shows the counterparty as "Shared with"', () => {
    const counterparty = new PrivateKey(3).toPublicKey().toString()
    const copy = rabinPromptCopy(APP, parseRabinPromptMessage(JSON.stringify(toRabinPromptMessage({
      originator: APP, securityLevel: 2, logicalProtocolID: 'example oracle', keyID: 'feed 1', counterparty, privileged: false, operation: 'key', bits: 2048
    })))!)
    expect(copy.rows).toContainEqual({ label: 'Shared with', value: counterparty, mono: true })
  })
})

describe('desktop Rabin prompt message', () => {
  const authorization = {
    originator: APP,
    securityLevel: 2 as const,
    logicalProtocolID: 'example oracle',
    keyID: 'feed 1',
    counterparty: 'self' as const,
    privileged: false,
    operation: 'sign' as const,
    bits: 2048 as const,
    messageLength: 3,
    messageSha256: ABC_SHA256
  }

  it('round-trips a well-formed request', () => {
    const message = JSON.stringify(toRabinPromptMessage(authorization))
    expect(parseRabinPromptMessage(message)).toEqual({ type: 'rabin_sign', originator: APP, securityLevel: 2, logicalProtocolID: 'example oracle', keyID: 'feed 1', counterparty: 'self', bits: 2048, messageLength: 3, messageSha256: ABC_SHA256 })
  })

  it.each([
    ['not JSON', 'nope'],
    ['an array', '[]'],
    ['an unknown type', JSON.stringify({ ...toRabinPromptMessage(authorization), type: 'rabin_decrypt' })],
    ['an unsupported size', JSON.stringify({ ...toRabinPromptMessage(authorization), bits: 1024 })],
    ['a missing digest', JSON.stringify({ ...toRabinPromptMessage(authorization), messageSha256: undefined })],
    ['an empty key name', JSON.stringify({ ...toRabinPromptMessage(authorization), keyID: '' })]
  ])('cannot be approved when it is %s', (_label, message) => {
    expect(parseRabinPromptMessage(message)).toBeNull()
  })
})

describe('desktop permission module preferences with Rabin', () => {
  const registry = buildPermissionModuleRegistry([btmsPermissionModule, mandalaPermissionModule, rabinPermissionModule])

  it('ships Rabin enabled by default with its prompt component', () => {
    expect(registry.getDefaultEnabledPermissionModules()).toEqual(['btms', 'mandala', 'rabin'])
    expect(registry.restoreEnabledPermissionModules()).toEqual(['btms', 'mandala', 'rabin'])
    expect(registry.restoreEnabledPermissionModules(['btms', 'mandala'])).toEqual(['btms', 'mandala', 'rabin'])
    expect(registry.getPermissionModuleById('rabin')?.Prompt).toBeDefined()
  })
})
