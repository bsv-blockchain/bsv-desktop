/**
 * Registration of the BRC-207 color module and its lifecycle (Task 12).
 *
 * Cases pinned here:
 * - composition: no wallet context throws; the attested and Mandala issuer
 *   profiles are registered; the configured overlay is passed through; an
 *   invalid or duplicate overlay row is skipped instead of bricking wallet
 *   open; none configured registers the Mandala profile with no overlays
 *   (fail closed, S5); the store is namespaced by identity and chain;
 * - lifecycle: a rebuild and a close dispose the previous modules exactly
 *   once (scheduler stopped, `online` listener removed, grants dropped,
 *   module disposed); a factory that throws mid-build leaks nothing;
 * - the real module behind the real manager: BRC-207 capability, A.115
 *   (`seekPermission:false` errors without a prompt), A.13 (a bare digest
 *   under a p color key is refused without a prompt or a signature);
 * - holder-send linkage (D20): the module never intercepts
 *   `specific linkage revelation 2 p color …`; with the default config there
 *   is no prompt; with the prompts enabled one grant covers later sends, and
 *   it never covers a non-overlay counterparty or another originator.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The real defaults (src/lib/WalletContext.tsx), except grouped permissions:
// those fetch the originator's manifest over the network.
const DEFAULTS = vi.hoisted(() => ({
  differentiatePrivilegedOperations: true,
  seekBasketInsertionPermissions: false,
  seekBasketListingPermissions: false,
  seekBasketRemovalPermissions: false,
  seekCertificateAcquisitionPermissions: false,
  seekCertificateDisclosurePermissions: false,
  seekCertificateRelinquishmentPermissions: false,
  seekCertificateListingPermissions: false,
  seekGroupedPermission: false,
  seekPermissionsForIdentityKeyRevelation: false,
  seekPermissionsForIdentityResolution: false,
  seekPermissionsForKeyLinkageRevelation: false,
  seekPermissionsForPublicKeyRevelation: false,
  seekPermissionWhenApplyingActionLabels: false,
  seekPermissionWhenListingActionsByLabel: false,
  seekProtocolPermissionsForEncrypting: false,
  seekProtocolPermissionsForHMAC: false,
  seekProtocolPermissionsForSigning: true,
  seekSpendingPermissions: true
}))
vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: DEFAULTS }))
vi.mock('@bsv/btms-permission-module-ui', () => ({ BtmsPermissionPrompt: () => null }))

import { PrivateKey } from '@bsv/sdk'
import { ATTESTED_PROFILE_ID } from '@bsv/color-permission-module'
import { MANDALA_PROFILE_ID, createMandalaOverlayProvider } from '@bsv/mandala/profile'
import { colorPermissionModule, createHostColorModule } from '../src/lib/permissionModules/color'
import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'
import type { PermissionModuleContext, PermissionModuleDefinition } from '../src/lib/permissionModules/types'
import type { MandalaOverlaySetting } from '../src/lib/networkConfig'

const K = '02798b81951a6a8c7ef8beda09b06a23031d7efaf37b663265e0188ab378124046'
const K2 = new PrivateKey(7).toPublicKey().toString()
const IDENTITY = '02' + '11'.repeat(32)
const B = '02' + 'ab'.repeat(32)
const B2 = '03' + 'ef'.repeat(32)
const wallet = {} as any

const ctx = (overlays: MandalaOverlaySetting[]): PermissionModuleContext => ({
  identityKey: IDENTITY,
  chain: 'test',
  settings: { mandalaOverlays: overlays } as any
})

function memoryColorStore () {
  const data = new Map<string, string>()
  const k = (id: string, chain: string, key: string) => `${id}|${chain}|${key}`
  return {
    get: vi.fn(async (id: string, chain: string, key: string) => data.get(k(id, chain, key))),
    set: vi.fn(async (id: string, chain: string, key: string, value: string) => { data.set(k(id, chain, key), value) }),
    delete: vi.fn(async (id: string, chain: string, key: string) => { data.delete(k(id, chain, key)) }),
    keys: vi.fn(async (id: string, chain: string, prefix: string) => {
      const p = k(id, chain, prefix)
      return [...data.keys()].filter(x => x.startsWith(p)).map(x => x.slice(k(id, chain, '').length))
    })
  }
}

function spyDeps () {
  const module = { settle: vi.fn(async () => ({ results: [] })), dispose: vi.fn() }
  const scheduler = { stop: vi.fn(), runNow: vi.fn(async () => {}) }
  return {
    module,
    scheduler,
    createColorModule: vi.fn((_o: any) => module as any),
    createAttestedProfile: vi.fn(() => ({ id: ATTESTED_PROFILE_ID }) as any),
    createMandalaProfile: vi.fn((_o: any) => ({ id: MANDALA_PROFILE_ID }) as any),
    // the real one: it is what validates a configured overlay row
    createMandalaOverlayProvider: vi.fn((o: any) => createMandalaOverlayProvider(o)),
    createStore: vi.fn((_i: string, _c: string) => ({}) as any),
    createDefaultProvider: vi.fn((_o: any) => ({ id: 'ship' }) as any),
    startScheduler: vi.fn((_o: any) => scheduler)
  }
}

describe('createHostColorModule', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  test('needs a wallet context', () => {
    expect(() => createHostColorModule({ wallet, adminOriginator: 'admin' })).toThrow('The 1Color module needs the wallet identity and network')
  })

  test('registers attested + Mandala issuer profiles with the configured overlay', () => {
    const deps = spyDeps()
    const m = createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([{ url: 'https://ov.example', identityKey: K }]) }, deps)
    expect(m).toBe(deps.module)
    const opts = deps.createColorModule.mock.calls[0][0]
    expect(Object.keys(opts.profiles).sort()).toEqual([ATTESTED_PROFILE_ID, MANDALA_PROFILE_ID].sort())
    expect(opts.wallet).toBe(wallet)
    expect(opts.provider).toEqual({ id: 'ship' })
    expect(opts.store).toBe(deps.createStore.mock.results[0].value)
    expect(typeof opts.requestTokenAccess).toBe('function')
    expect(deps.createMandalaProfile).toHaveBeenCalledWith({ overlays: [{ url: 'https://ov.example', identityKey: K }] })
    expect(deps.createStore).toHaveBeenCalledWith(IDENTITY, 'test')
    expect(deps.createDefaultProvider).toHaveBeenCalledWith({ chain: 'test' })
    expect(deps.startScheduler).toHaveBeenCalledTimes(1)
  })

  test('no configured overlay registers the Mandala profile with none (fail closed)', () => {
    const deps = spyDeps()
    createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([]) }, deps)
    expect(deps.createMandalaProfile).toHaveBeenCalledWith({ overlays: [] })
    const deps2 = spyDeps()
    createHostColorModule({ wallet, adminOriginator: 'admin', context: { ...ctx([]), settings: {} as any } }, deps2)
    expect(deps2.createMandalaProfile).toHaveBeenCalledWith({ overlays: [] })
  })

  test('an invalid or duplicate overlay row is skipped, not fatal', () => {
    const deps = spyDeps()
    createHostColorModule({
      wallet,
      adminOriginator: 'admin',
      context: ctx([
        { url: 'https://bad.example', identityKey: '02' + 'ff'.repeat(32) }, // not on the curve
        { url: 'https://ov.example', identityKey: K },
        { url: 'https://dup.example', identityKey: K },
        { url: 'https://ov2.example', identityKey: K2 }
      ])
    }, deps)
    expect(deps.createMandalaProfile).toHaveBeenCalledWith({
      overlays: [{ url: 'https://ov.example', identityKey: K }, { url: 'https://ov2.example', identityKey: K2 }]
    })
  })

  test('the scheduler settles as the admin originator', async () => {
    const deps = spyDeps()
    createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([]) }, deps)
    await deps.startScheduler.mock.calls[0][0].settle()
    expect(deps.module.settle).toHaveBeenCalledWith(undefined, 'admin')
  })

  test('dispose stops the scheduler and disposes the module once', () => {
    const deps = spyDeps()
    const m = createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([]) }, deps)
    colorPermissionModule.dispose!(m)
    colorPermissionModule.dispose!(m)
    expect(deps.scheduler.stop).toHaveBeenCalledTimes(1)
    expect(deps.module.dispose).toHaveBeenCalledTimes(1)
    // an unknown value is ignored
    expect(() => colorPermissionModule.dispose!({})).not.toThrow()
  })

  test('a scheduler that fails to start disposes the module', () => {
    const deps = spyDeps()
    deps.startScheduler.mockImplementation(() => { throw new Error('no window') })
    expect(() => createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([]) }, deps)).toThrow('no window')
    expect(deps.module.dispose).toHaveBeenCalledTimes(1)
  })

  test('definition', () => {
    expect(colorPermissionModule.id).toBe('color')
    expect(colorPermissionModule.label).toBe('1Color Token Module')
    expect(colorPermissionModule.enabledByDefault).toBe(true)
    expect(colorPermissionModule.createModule).toBe(createHostColorModule)
    expect(typeof colorPermissionModule.Prompt).toBe('function')
  })
})

describe('PermissionQueueManager module lifecycle', () => {
  beforeEach(() => vi.stubGlobal('window', {}))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  const setup = (defs: PermissionModuleDefinition[]) => {
    const queue = new PermissionQueueManager()
    queue.adminOriginator = 'admin.example.com'
    queue.permissionsConfig = {} as any
    queue.enabledPermissionModules = defs.map(d => d.id)
    const byId = new Map(defs.map(d => [d.id, d]))
    queue.setPermissionsModuleHelpers(id => byId.get(id), new Map())
    return queue
  }

  test('disposes the previous modules on rebuild and on close', () => {
    let n = 0
    const created: unknown[] = []
    const dispose = vi.fn()
    const def: PermissionModuleDefinition = {
      id: 'x', label: 'x', createModule: () => { const m = { n: n++ }; created.push(m); return m }, dispose
    }
    const queue = setup([def])
    queue.setPermissionsManager(queue.createPermissionsManager(wallet, ctx([])))
    queue.setPermissionsManager(queue.createPermissionsManager(wallet, ctx([])))
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenLastCalledWith(created[0])
    queue.setPermissionsManager(null)
    expect(dispose).toHaveBeenCalledTimes(2)
    expect(dispose).toHaveBeenLastCalledWith(created[1])
    queue.setPermissionsManager(null)
    queue.disposePermissionModules()
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  test('passes the context to every module', () => {
    const createModule = vi.fn(() => ({}))
    const queue = setup([{ id: 'x', label: 'x', createModule }])
    const c = ctx([])
    queue.createPermissionsManager(wallet, c)
    expect((createModule.mock.calls[0] as any[])[0]).toMatchObject({ wallet, adminOriginator: 'admin.example.com', context: c })
  })

  test('a dispose that throws is logged and the rest still dispose', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = vi.fn()
    const queue = setup([
      { id: 'a', label: 'a', createModule: () => ({}), dispose: () => { throw new Error('boom') } },
      { id: 'b', label: 'b', createModule: () => ({}), dispose: ok }
    ])
    queue.createPermissionsManager(wallet, ctx([]))
    expect(() => queue.disposePermissionModules()).not.toThrow()
    expect(ok).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalled()
  })

  test('a module factory that throws disposes the modules already built in that call', () => {
    const dispose = vi.fn()
    const queue = setup([
      { id: 'a', label: 'a', createModule: () => ({ a: 1 }), dispose },
      { id: 'b', label: 'b', createModule: () => { throw new Error('no store') } }
    ])
    expect(() => queue.createPermissionsManager(wallet, ctx([]))).toThrow('no store')
    expect(dispose).toHaveBeenCalledTimes(1)
    queue.disposePermissionModules()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

describe('real module behind the real manager', () => {
  const linkageName = (p: string, x: string) =>
    `specific linkage revelation 2 p color ${'a'.repeat(64)}v0 ${Buffer.from(p).toString('hex')} ${Buffer.from(x).toString('hex')}`

  let queue: PermissionQueueManager
  let pm: any
  let prompt: ReturnType<typeof vi.fn>
  let fakeWallet: Record<string, ReturnType<typeof vi.fn>>
  let protocolPrompts: any[]
  let fakeWindow: EventTarget & { electronAPI: unknown }

  const build = (overlays: MandalaOverlaySetting[] = [{ url: 'https://ov.example', identityKey: K }]) => {
    queue = new PermissionQueueManager()
    queue.adminOriginator = 'admin.example.com'
    queue.permissionsConfig = { ...DEFAULTS } as any
    queue.enabledPermissionModules = ['color']
    queue.setPermissionsModuleHelpers(id => (id === 'color' ? colorPermissionModule : undefined), new Map([['color', prompt as any]]))
    protocolPrompts = []
    // Every item the queue ever showed, in order (items are new objects per request).
    queue.on('snapshot', s => {
      for (const item of s.protocolRequests) if (!protocolPrompts.includes(item)) protocolPrompts.push(item)
    })
    pm = queue.createPermissionsManager(fakeWallet as any, ctx(overlays))
    queue.setPermissionsManager(pm)
    return pm
  }

  /** Approves every queued protocol item as the UI would (deferred: never inside the callback). */
  const autoApprove = () => {
    const handled = new Set<any>()
    queue.on('snapshot', s => {
      for (const item of s.protocolRequests) {
        if (handled.has(item)) continue
        handled.add(item)
        void Promise.resolve().then(async () => {
          if (item.colorLinkage) await queue.approveColorLinkage(item.requestID).catch(() => {})
          else await pm.grantPermission({ requestID: item.requestID, ephemeral: true }).catch(() => {})
          queue.advanceProtocolQueue()
        })
      }
    })
  }

  const holderSend = async (b: string, name: string, originator = 'app.example', verifier = K) => {
    await pm.revealCounterpartyKeyLinkage({ counterparty: b, verifier }, originator)
    await pm.encrypt({ plaintext: [1], protocolID: [2, name], keyID: 'color', counterparty: verifier }, originator)
    await pm.encrypt({ plaintext: [0], protocolID: [2, name], keyID: 'color', counterparty: verifier }, originator)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fakeWindow = Object.assign(new EventTarget(), { electronAPI: { colorStore: memoryColorStore() } })
    vi.stubGlobal('window', fakeWindow)
    prompt = vi.fn(async () => false)
    fakeWallet = {
      getPublicKey: vi.fn(async () => ({ publicKey: IDENTITY })),
      getVersion: vi.fn(async () => ({ version: 'wallet-brc100-1.0.0' })),
      listOutputs: vi.fn(async () => ({ totalOutputs: 0, outputs: [] })),
      listActions: vi.fn(async () => ({ totalActions: 0, actions: [] })),
      createSignature: vi.fn(async () => ({ signature: [1] })),
      revealCounterpartyKeyLinkage: vi.fn(async () => ({ encryptedLinkage: [1] })),
      encrypt: vi.fn(async () => ({ ciphertext: [9] }))
    }
    build()
  })
  afterEach(() => {
    queue.disposePermissionModules()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('advertises the BRC-207 capability', async () => {
    expect((await pm.getVersion({}, 'app.example')).version).toContain('brc207-color')
  })

  test('A.115: an inventory read with seekPermission false errors without a prompt', async () => {
    await expect(pm.listOutputs({ basket: 'p color assets', seekPermission: false }, 'app.example'))
      .rejects.toThrow('Colored Tokens inventory read permission is required')
    expect(prompt).not.toHaveBeenCalled()
  })

  test('A.13: a bare digest under a p color key is refused without a prompt', async () => {
    await expect(pm.createSignature({
      protocolID: [2, `p color ${'a'.repeat(64)}v0 41513d3d 41673d3d`],
      keyID: 'color',
      counterparty: 'self',
      hashToDirectlySign: Array(32).fill(1)
    }, 'app.example')).rejects.toThrow()
    expect(prompt).not.toHaveBeenCalled()
    expect(fakeWallet.createSignature).not.toHaveBeenCalled()
  })

  test('the settle scheduler is bound to the window and removed on close', async () => {
    const remove = vi.spyOn(fakeWindow, 'removeEventListener')
    queue.setPermissionsManager(null)
    expect(remove).toHaveBeenCalledWith('online', expect.any(Function))
  })

  test('holder-send linkage: default config never prompts', async () => {
    await holderSend(B, linkageName('AAAA', 'BBBB'))
    await holderSend(B, linkageName('CCCC', 'DDDD'))
    expect(protocolPrompts).toHaveLength(0)
    expect(fakeWallet.encrypt).toHaveBeenCalledTimes(4)
    // the module did not intercept: the underlying encrypt got the exact args
    expect(fakeWallet.encrypt.mock.calls[0][0]).toEqual({ plaintext: [1], protocolID: [2, linkageName('AAAA', 'BBBB')], keyID: 'color', counterparty: K })
    expect(fakeWallet.revealCounterpartyKeyLinkage).toHaveBeenCalledTimes(2)
    expect(fakeWallet.revealCounterpartyKeyLinkage.mock.calls[0][0]).toEqual({ counterparty: B, verifier: K })
  })

  const promptsOn = () => {
    queue.setPermissionsConfig({ ...DEFAULTS, seekPermissionsForKeyLinkageRevelation: true, seekProtocolPermissionsForEncrypting: true } as any)
  }

  test('holder-send linkage with prompts enabled: one grant covers later sends', async () => {
    promptsOn()
    autoApprove()
    await holderSend(B, linkageName('AAAA', 'BBBB'))
    expect(protocolPrompts.map(p => p.description)).toEqual([expect.stringContaining('reveal your link to'), 'Mandala token sending'])
    expect(protocolPrompts.every(p => p.colorLinkage === true)).toBe(true)
    await holderSend(B, linkageName('CCCC', 'DDDD')) // new random name, same B: no prompt
    await holderSend(B2, linkageName('EEEE', 'FFFF')) // new B: one counterparty-linkage prompt only
    expect(protocolPrompts).toHaveLength(3)
    expect(protocolPrompts[2].description).toBe(`Mandala token sending: reveal your link to ${B2} to the Mandala overlay`)
    expect(fakeWallet.encrypt).toHaveBeenCalledTimes(6)
    expect(fakeWallet.revealCounterpartyKeyLinkage).toHaveBeenCalledTimes(3)
  })

  test('measurement: without the policy every send prompts at least twice', async () => {
    // No overlay configured: the policy can never match, so this is the plain
    // manager behaviour the policy replaces (recorded in the task report).
    queue.disposePermissionModules()
    build([])
    promptsOn()
    autoApprove()
    await holderSend(B, linkageName('AAAA', 'BBBB'))
    await holderSend(B, linkageName('CCCC', 'DDDD'))
    console.info(`[measurement] linkage prompts across two sends without the policy: ${protocolPrompts.length}`)
    expect(protocolPrompts).toHaveLength(6) // reveal + 2 encrypts per send, ephemerally approved
    expect(protocolPrompts.some(p => p.colorLinkage)).toBe(false)
  })

  test('the linkage grant never covers a non-overlay counterparty or another originator', async () => {
    promptsOn()
    autoApprove()
    await holderSend(B, linkageName('AAAA', 'BBBB'))
    expect(protocolPrompts).toHaveLength(2)
    // toward a non-overlay key: an ordinary prompt
    await pm.encrypt({ plaintext: [1], protocolID: [2, linkageName('GGGG', 'HHHH')], keyID: 'color', counterparty: K2 }, 'app.example')
    expect(protocolPrompts).toHaveLength(3)
    expect(protocolPrompts[2].colorLinkage).toBeUndefined()
    // another originator, same name toward K: prompts
    await pm.encrypt({ plaintext: [1], protocolID: [2, linkageName('AAAA', 'BBBB')], keyID: 'color', counterparty: K }, 'other.example')
    expect(protocolPrompts).toHaveLength(4)
    expect(protocolPrompts[3]).toMatchObject({ originator: 'other.example', colorLinkage: true })
    // after the modules are disposed, app.example prompts again
    queue.disposePermissionModules()
    await pm.encrypt({ plaintext: [1], protocolID: [2, linkageName('IIII', 'JJJJ')], keyID: 'color', counterparty: K }, 'app.example')
    expect(protocolPrompts).toHaveLength(5)
  })
})
