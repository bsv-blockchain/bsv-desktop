/**
 * Registration of the BRC-207 color module and its lifecycle (Task 12).
 *
 * Cases pinned here:
 * - composition: no wallet context throws; only the Mandala issuer-v1
 *   profile is registered (Revision 3: no attested profile), with the host
 *   ledger and the configured overlay; an invalid or duplicate overlay row is
 *   skipped instead of bricking wallet open; none configured registers the
 *   Mandala profile with no overlays and no runtime (fail closed, S5); the
 *   stores are namespaced by identity and chain; the lib is configured with
 *   the first overlay and the host store, and reset on dispose;
 * - the drain releases only what the host ledger records `settled`;
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
import { MANDALA_PROFILE_ID, createMandalaOverlayProvider } from '@bsv/mandala/profile'
import { createHostLedger, memoryStorage } from '@bsv/mandala'
import { colorPermissionModule, createHostColorModule, ColorLocalStorageRequiredError } from '../src/lib/permissionModules/color'
import { colorLinkageOverlayKeys } from '../src/lib/permissionModules/color/overlayKeys'
import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'
import type { PermissionModuleContext, PermissionModuleDefinition } from '../src/lib/permissionModules/types'
import type { MandalaOverlaySetting } from '../src/lib/networkConfig'

const K = '02798b81951a6a8c7ef8beda09b06a23031d7efaf37b663265e0188ab378124046'
const K2 = new PrivateKey(7).toPublicKey().toString()
const IDENTITY = '02' + '11'.repeat(32)
const B = '02' + 'ab'.repeat(32)
const B2 = '03' + 'ef'.repeat(32)
const wallet = {} as any

/** `local`: null = remote storage selected at build; else the live answer. */
const ctx = (overlays: MandalaOverlaySetting[], local: (() => boolean) | null = () => true): PermissionModuleContext => ({
  identityKey: IDENTITY,
  chain: 'test',
  settings: { mandalaOverlays: overlays } as any,
  localStorageSelected: local !== null,
  isLocalStorageActive: async () => local?.() === true
})
// On the curve's x range but not a point: it passes the identity-key regex.
const OFF_CURVE = '02' + 'ff'.repeat(32)

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
  const module = {
    capabilities: { 'brc207-color': '4' },
    markSettled: vi.fn(async (_txid: string) => {}),
    dispose: vi.fn(),
    handleRequest: vi.fn(async (_req: any, _next: any) => 'handled'),
    onRequest: vi.fn(async (req: any) => ({ args: req.args })),
    onResponse: vi.fn(async (res: unknown) => res)
  }
  const scheduler = { stop: vi.fn(), runNow: vi.fn(async () => {}) }
  const heldListeners = new Set<(txid: string) => void>()
  const guard = {
    held: vi.fn(async () => [] as string[]),
    release: vi.fn(async () => {}),
    onHeld: vi.fn((cb: (txid: string) => void) => {
      heldListeners.add(cb)
      return () => { heldListeners.delete(cb) }
    })
  }
  const drain = { drain: vi.fn(async () => ({ released: [] as string[] })) }
  const mandalaStorage = memoryStorage()
  const ledger = createHostLedger(mandalaStorage)
  const runtime = { tick: vi.fn(async () => ({ results: [] as any[], received: [] as any[], failed: [] as any[] })) }
  return {
    ledger,
    runtime,
    mandalaStorage,
    module,
    scheduler,
    guard,
    drain,
    heldListeners,
    guardBridge: vi.fn(() => guard as any),
    createReleaseDrain: vi.fn((_o: any) => drain),
    createColorModule: vi.fn((_o: any) => module as any),
    createMandalaProfile: vi.fn((_o: any) => ({ id: MANDALA_PROFILE_ID }) as any),
    // the real one: it is what validates a configured overlay row
    createMandalaOverlayProvider: vi.fn((o: any) => createMandalaOverlayProvider(o)),
    createStore: vi.fn((_i: string, _c: string) => ({}) as any),
    createMandalaStorage: vi.fn((_i: string, _c: string) => mandalaStorage),
    createHostLedger: vi.fn((_s: any) => ledger),
    configureMandala: vi.fn((_e: any) => {}),
    createRuntime: vi.fn((_o: any) => runtime),
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

  test('registers only the Mandala issuer-v1 profile, with the host ledger and the configured overlay', () => {
    const deps = spyDeps()
    const m = createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([{ url: 'https://ov.example', identityKey: K }]) }, deps)
    // a storage-mode guard around the module: everything else passes through
    expect(m.capabilities).toEqual({ 'brc207-color': '4' })
    expect(colorLinkageOverlayKeys(m)).toEqual([K])
    const opts = deps.createColorModule.mock.calls[0][0]
    expect(Object.keys(opts.profiles)).toEqual([MANDALA_PROFILE_ID])
    expect(opts.wallet).toBe(wallet)
    expect(opts.provider).toEqual({ id: 'ship' })
    expect(opts.store).toBe(deps.createStore.mock.results[0].value)
    expect(typeof opts.requestTokenAccess).toBe('function')
    expect(deps.createMandalaProfile).toHaveBeenCalledWith({ overlays: [{ url: 'https://ov.example', identityKey: K }], ledger: deps.ledger })
    expect(deps.createStore).toHaveBeenCalledWith(IDENTITY, 'test')
    expect(deps.createMandalaStorage).toHaveBeenCalledWith(IDENTITY, 'test')
    expect(deps.createHostLedger).toHaveBeenCalledWith(deps.mandalaStorage)
    expect(deps.configureMandala).toHaveBeenCalledWith({ storage: deps.mandalaStorage, overlayUrl: 'https://ov.example', overlayIdentityKey: K })
    const ro = deps.createRuntime.mock.calls[0][0]
    expect(ro).toMatchObject({ ledger: deps.ledger, overlayIdentityKey: K })
    expect(Object.keys(opts).sort()).toEqual(['profiles', 'provider', 'requestTokenAccess', 'store', 'wallet'])
    expect(deps.createDefaultProvider).toHaveBeenCalledWith({ chain: 'test' })
    expect(deps.startScheduler).toHaveBeenCalledTimes(1)
  })

  test('no configured overlay registers the Mandala profile with none (fail closed)', () => {
    const deps = spyDeps()
    createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([]) }, deps)
    expect(deps.createMandalaProfile).toHaveBeenCalledWith({ overlays: [], ledger: deps.ledger })
    // the lib's globals are cleared, so no earlier wallet's overlay is used
    expect(deps.configureMandala).toHaveBeenCalledWith({ storage: deps.mandalaStorage, overlayUrl: '', overlayIdentityKey: '' })
    expect(deps.createRuntime).not.toHaveBeenCalled()
    const deps2 = spyDeps()
    createHostColorModule({ wallet, adminOriginator: 'admin', context: { ...ctx([]), settings: {} as any } }, deps2)
    expect(deps2.createMandalaProfile).toHaveBeenCalledWith({ overlays: [], ledger: deps2.ledger })
  })

  test('an invalid or duplicate overlay row is skipped, not fatal', () => {
    const deps = spyDeps()
    createHostColorModule({
      wallet,
      adminOriginator: 'admin',
      context: ctx([
        { url: 'https://bad.example', identityKey: OFF_CURVE }, // not on the curve
        { url: 'https://ov.example', identityKey: K },
        { url: 'https://dup.example', identityKey: K },
        { url: 'https://ov2.example', identityKey: K2 }
      ])
    }, deps)
    expect(deps.createMandalaProfile).toHaveBeenCalledWith({
      overlays: [{ url: 'https://ov.example', identityKey: K }, { url: 'https://ov2.example', identityKey: K2 }],
      ledger: deps.ledger
    })
    // the single-overlay lib runs against the first usable overlay
    expect(deps.configureMandala).toHaveBeenCalledWith(expect.objectContaining({ overlayUrl: 'https://ov.example', overlayIdentityKey: K }))
    expect(deps.createRuntime.mock.calls[0][0].overlayIdentityKey).toBe(K)
  })

  test('the linkage policy gets the same validated overlay keys as the profile', () => {
    const deps = spyDeps()
    const m = createHostColorModule({
      wallet,
      adminOriginator: 'admin',
      context: ctx([
        { url: 'https://bad.example', identityKey: OFF_CURVE },
        { url: 'https://ov.example', identityKey: K },
        { url: 'https://dup.example', identityKey: K.toUpperCase() }
      ])
    }, deps)
    expect(colorLinkageOverlayKeys(m)).toEqual([K])
    expect(colorLinkageOverlayKeys({})).toEqual([])
    expect(colorLinkageOverlayKeys(undefined)).toEqual([])
    colorPermissionModule.dispose!(m)
    expect(colorLinkageOverlayKeys(m)).toEqual([])
  })

  describe('storage mode (contract §8.2: the broadcast guard lives in local storage only)', () => {
    const req = { method: 'listOutputs', args: { basket: 'p color assets' }, originator: 'app.example' }
    const refused = { name: 'ColorLocalStorageRequiredError', code: 'ERR_COLOR_LOCAL_STORAGE_REQUIRED', message: 'Colored Tokens need local wallet storage' }

    const expectRefusing = async (m: any, deps: ReturnType<typeof spyDeps>) => {
      const next = vi.fn(async () => 'raw')
      await expect(m.handleRequest(req, next)).rejects.toMatchObject(refused)
      await expect(m.handleRequest(req, next)).rejects.toBeInstanceOf(ColorLocalStorageRequiredError)
      await expect(m.onRequest(req)).rejects.toMatchObject(refused)
      await expect(m.onResponse({}, { method: 'createAction', originator: 'app.example' })).rejects.toMatchObject(refused)
      expect(next).not.toHaveBeenCalled()
      expect(deps.module.handleRequest).not.toHaveBeenCalled()
      expect(deps.module.onRequest).not.toHaveBeenCalled()
    }

    test('remote active storage builds a refusing module and starts nothing', async () => {
      const deps = spyDeps()
      const m: any = createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([{ url: 'https://ov.example', identityKey: K }], null) }, deps)
      await expectRefusing(m, deps)
      // no BRC-207 capability: an app must not think it can use p color here
      expect(m.capabilities ?? {}).toEqual({})
      await expect(m.markSettled('ab'.repeat(32))).resolves.toBeUndefined()
      expect(colorLinkageOverlayKeys(m)).toEqual([])
      for (const f of ['createColorModule', 'createStore', 'createMandalaStorage', 'createHostLedger', 'configureMandala', 'createRuntime', 'createDefaultProvider', 'startScheduler', 'createReleaseDrain', 'guardBridge'] as const) {
        expect(deps[f]).not.toHaveBeenCalled()
      }
      colorPermissionModule.dispose!(m)
      colorPermissionModule.dispose!(m)
    })

    test('a missing storage mode or a failing live check counts as remote (fail closed)', async () => {
      const deps = spyDeps()
      const { localStorageSelected: _, ...noMode } = ctx([])
      await expectRefusing(createHostColorModule({ wallet, adminOriginator: 'admin', context: noMode as any }, deps), deps)
      expect(deps.createColorModule).not.toHaveBeenCalled()

      // local selected, but the live check rejects, answers non-true, or is missing
      for (const isLocalStorageActive of [
        async () => { throw new Error('no manager') },
        () => { throw new Error('sync throw') },
        async () => 'yes',
        undefined
      ]) {
        const d = spyDeps()
        const m: any = createHostColorModule({ wallet, adminOriginator: 'admin', context: { ...ctx([]), isLocalStorageActive } as any }, d)
        await expect(m.handleRequest(req, vi.fn())).rejects.toMatchObject(refused)
        await expect(m.onRequest(req)).rejects.toMatchObject(refused)
        expect(d.module.handleRequest).not.toHaveBeenCalled()
        expect(d.module.onRequest).not.toHaveBeenCalled()
        // no overlay configured: no runtime, the tick only drains
        expect(await d.startScheduler.mock.calls[0][0].settle()).toEqual({ results: [] })
        expect(m.capabilities).toEqual({})
        colorPermissionModule.dispose!(m)
      }
    })

    test('a switch to remote storage after the build refuses requests live and skips settle', async () => {
      const deps = spyDeps()
      let local = true
      const m: any = createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([{ url: 'https://ov.example', identityKey: K }], () => local) }, deps)
      const next = vi.fn(async () => 'raw')
      expect(await m.handleRequest(req, next)).toBe('handled')
      expect(deps.module.handleRequest).toHaveBeenCalledWith(req, next)

      local = false
      await expect(m.handleRequest(req, next)).rejects.toMatchObject(refused)
      await expect(m.onRequest(req)).rejects.toMatchObject(refused)
      expect(next).not.toHaveBeenCalled()
      expect(m.capabilities).toEqual({})
      expect(deps.module.handleRequest).toHaveBeenCalledTimes(1)
      expect(deps.module.onRequest).not.toHaveBeenCalled()
      expect(colorLinkageOverlayKeys(m)).toEqual([])
      // the runtime gets the live storage check (it skips its steps itself)
      const { isActive } = deps.createRuntime.mock.calls[0][0]
      expect(await isActive()).toBe(false)

      local = true
      expect(await isActive()).toBe(true)
      expect(await m.onRequest(req)).toEqual({ args: req.args })
      expect(m.capabilities).toEqual({ 'brc207-color': '4' })
      expect(colorLinkageOverlayKeys(m)).toEqual([K])
      await deps.startScheduler.mock.calls[0][0].settle()
      expect(deps.runtime.tick).toHaveBeenCalledTimes(1)
      // the host still drives the real module through the guard
      await m.markSettled('ab'.repeat(32))
      expect(deps.module.markSettled).toHaveBeenCalledWith('ab'.repeat(32))
      colorPermissionModule.dispose!(m)
      expect(deps.module.dispose).toHaveBeenCalledTimes(1)
    })
  })

  test('the runtime reaches the managed wallet, MessageBox and markSettled of this build', async () => {
    const deps = spyDeps()
    const managed = { tag: 'pm' } as any
    const box = { listMessages: vi.fn(), acknowledgeMessage: vi.fn() }
    createHostColorModule({
      wallet,
      adminOriginator: 'admin',
      context: { ...ctx([{ url: 'https://ov.example', identityKey: K }]), managedWallet: () => managed, messageBox: () => box }
    }, deps)
    const ro = deps.createRuntime.mock.calls[0][0]
    expect(ro.wallet()).toBe(managed)
    expect(ro.messageBox()).toBe(box)
    await ro.markSettled('cd'.repeat(32))
    expect(deps.module.markSettled).toHaveBeenCalledWith('cd'.repeat(32))
  })

  test('the drain releases only what the host ledger records settled (never color.v1.* keys)', async () => {
    const deps = spyDeps()
    createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([{ url: 'https://ov.example', identityKey: K }]) }, deps)
    const o = deps.createReleaseDrain.mock.calls[0][0]
    expect(o).toMatchObject({ api: deps.guard, identityKey: IDENTITY, chain: 'test' })
    const settled = 'ab'.repeat(32)
    const pending = 'cd'.repeat(32)
    const refused = 'ef'.repeat(32)
    const at = Date.now()
    await deps.ledger.put({ v: 1, txid: settled, assetId: `${'11'.repeat(32)}_0`, state: 'settled', outputs: [0], at })
    await deps.ledger.put({ v: 1, txid: pending, assetId: `${'11'.repeat(32)}_0`, state: 'pending', outputs: [0], at })
    await deps.ledger.put({ v: 1, txid: refused, assetId: `${'11'.repeat(32)}_0`, state: 'refused', outputs: [0], at })
    expect(await o.isSettled(settled)).toBe(true)
    expect(await o.isSettled(pending)).toBe(false)
    expect(await o.isSettled(refused)).toBe(false)
    expect(await o.isSettled('12'.repeat(32))).toBe(false)
  })

  test('every tick runs the runtime, then the release drain (contract §8.2)', async () => {
    const deps = spyDeps()
    createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([{ url: 'https://ov.example', identityKey: K }]) }, deps)
    const order: string[] = []
    deps.runtime.tick.mockImplementation(async () => { order.push('tick'); return { results: [], received: [], failed: [] } })
    deps.drain.drain.mockImplementation(async () => { order.push('drain'); return { released: [] } })
    await deps.startScheduler.mock.calls[0][0].settle()
    expect(order).toEqual(['tick', 'drain'])
  })

  test('a failing tick still drains, and the failure reaches the scheduler', async () => {
    const deps = spyDeps()
    deps.runtime.tick.mockRejectedValue(new Error('overlay down'))
    createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([{ url: 'https://ov.example', identityKey: K }]) }, deps)
    await expect(deps.startScheduler.mock.calls[0][0].settle()).rejects.toThrow('overlay down')
    expect(deps.drain.drain).toHaveBeenCalledTimes(1)
  })

  test('a held event runs a settle tick; dispose unsubscribes it', () => {
    const deps = spyDeps()
    const m = createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([]) }, deps)
    expect(deps.heldListeners.size).toBe(1)
    for (const cb of deps.heldListeners) cb('ab'.repeat(32))
    expect(deps.scheduler.runNow).toHaveBeenCalledTimes(1)
    colorPermissionModule.dispose!(m)
    expect(deps.heldListeners.size).toBe(0)
  })

  test('without the guard bridge nothing is released and the module still builds', async () => {
    const deps = spyDeps()
    deps.guardBridge.mockReturnValue(undefined)
    createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([{ url: 'https://ov.example', identityKey: K }]) }, deps)
    expect(deps.createReleaseDrain).not.toHaveBeenCalled()
    await deps.startScheduler.mock.calls[0][0].settle()
    expect(deps.runtime.tick).toHaveBeenCalledTimes(1)
  })

  test('dispose stops the scheduler, resets the lib and disposes the module once', () => {
    const deps = spyDeps()
    const m = createHostColorModule({ wallet, adminOriginator: 'admin', context: ctx([{ url: 'https://ov.example', identityKey: K }]) }, deps)
    colorPermissionModule.dispose!(m)
    colorPermissionModule.dispose!(m)
    expect(deps.scheduler.stop).toHaveBeenCalledTimes(1)
    expect(deps.module.dispose).toHaveBeenCalledTimes(1)
    // the closed wallet's store and overlay are no longer the lib's
    expect(deps.configureMandala).toHaveBeenCalledTimes(2)
    const reset = deps.configureMandala.mock.calls[1][0]
    expect(reset).toMatchObject({ overlayUrl: '', overlayIdentityKey: '' })
    expect(reset.storage).not.toBe(deps.mandalaStorage)
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

  test('passes the context to every module, with this build\'s manager bound to the admin originator', async () => {
    const createModule = vi.fn(() => ({}))
    const queue = setup([{ id: 'x', label: 'x', createModule }])
    const c = ctx([])
    const underlying = { getVersion: vi.fn(async () => ({ version: 'v' })) } as any
    const pm = queue.createPermissionsManager(underlying, c)
    const args = (createModule.mock.calls[0] as any[])[0]
    expect(args).toMatchObject({ wallet: underlying, adminOriginator: 'admin.example.com', context: c })
    const managed = args.context.managedWallet()
    expect(managed).toBeDefined()
    const spy = vi.spyOn(pm, 'getVersion')
    await managed.getVersion({})
    expect(spy).toHaveBeenCalledWith({}, 'admin.example.com')
    await managed.getVersion({}, 'other.example')
    expect(spy).toHaveBeenLastCalledWith({}, 'other.example')
    // a later build's modules never get this manager
    queue.createPermissionsManager(underlying, c)
    expect((createModule.mock.calls[1] as any[])[0].context.managedWallet()).not.toBe(managed)
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

  const build = (overlays: MandalaOverlaySetting[] = [{ url: 'https://ov.example', identityKey: K }], local: (() => boolean) | null = () => true) => {
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
    pm = queue.createPermissionsManager(fakeWallet as any, ctx(overlays, local))
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
    fakeWindow = Object.assign(new EventTarget(), { electronAPI: { colorStore: memoryColorStore(), mandalaStore: memoryColorStore() } })
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

  test('an off-curve overlay key the profile drops gets no linkage grant', async () => {
    queue.disposePermissionModules()
    build([{ url: 'https://bad.example', identityKey: OFF_CURVE }])
    promptsOn()
    autoApprove()
    await holderSend(B, linkageName('AAAA', 'BBBB'), 'app.example', OFF_CURVE)
    await holderSend(B, linkageName('CCCC', 'DDDD'), 'app.example', OFF_CURVE)
    expect(protocolPrompts).toHaveLength(6)
    expect(protocolPrompts.some(p => p.colorLinkage)).toBe(false)
  })

  test('remote active storage: p color requests fail typed, without a prompt or the capability', async () => {
    queue.disposePermissionModules()
    build(undefined, null)
    expect((await pm.getVersion({}, 'app.example')).version).not.toContain('brc207-color')
    const refused = { name: 'ColorLocalStorageRequiredError', code: 'ERR_COLOR_LOCAL_STORAGE_REQUIRED', message: 'Colored Tokens need local wallet storage' }
    await expect(pm.listOutputs({ basket: 'p color assets' }, 'app.example')).rejects.toMatchObject(refused)
    fakeWallet.createAction = vi.fn(async () => ({ txid: 'ab'.repeat(32) }))
    await expect(pm.createAction({
      description: 'a color send',
      outputs: [{ lockingScript: '51', satoshis: 1, outputDescription: 'token', basket: `p color ${'a'.repeat(64)}v0 value` }]
    }, 'app.example')).rejects.toMatchObject(refused)
    fakeWallet.internalizeAction = vi.fn(async () => ({ accepted: true }))
    await expect(pm.internalizeAction({
      tx: [1, 2, 3],
      description: 'a color receipt',
      labels: ['color_offline'],
      outputs: [{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: `p color ${'a'.repeat(64)}v0 value` } }]
    }, 'app.example')).rejects.toMatchObject(refused)
    expect(fakeWallet.createAction).not.toHaveBeenCalled()
    expect(fakeWallet.internalizeAction).not.toHaveBeenCalled()
    expect(fakeWallet.listOutputs).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
  })

  test('a live switch to remote storage refuses the next p color request', async () => {
    let local = true
    queue.disposePermissionModules()
    build(undefined, () => local)
    await expect(pm.listOutputs({ basket: 'p color assets', seekPermission: false }, 'app.example'))
      .rejects.toThrow('Colored Tokens inventory read permission is required')
    local = false
    await expect(pm.listOutputs({ basket: 'p color assets', seekPermission: false }, 'app.example'))
      .rejects.toMatchObject({ name: 'ColorLocalStorageRequiredError' })
    expect((await pm.getVersion({}, 'app.example')).version).not.toContain('brc207-color')
  })

  test('remote active storage: no linkage grant toward the overlay', async () => {
    queue.disposePermissionModules()
    build(undefined, null)
    promptsOn()
    autoApprove()
    await holderSend(B, linkageName('AAAA', 'BBBB'))
    expect(protocolPrompts).toHaveLength(3)
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
