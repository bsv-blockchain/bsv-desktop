/**
 * The BRC-207 1Color module as a desktop permission module (contract §8.2).
 *
 * `createHostColorModule` builds `@bsv/color-permission-module` for one open
 * wallet (identity + chain) with the attested and Mandala issuer profiles, and
 * the host pieces around it: the durable store, the SHIP default provider,
 * the consent gate with exact-amount display, and the settle scheduler. The
 * permissions manager registers it under the scheme id `color`.
 *
 * Fail closed (S5): only Mandala overlays the user configured for this
 * network are passed to the Mandala profile. An invalid or duplicate row is
 * logged and skipped (one bad settings row must not stop the wallet from
 * opening); none configured means Mandala assets are refused.
 *
 * Broadcast guard (contract §8.2): the main process and the monitor worker
 * hold every unreleased transaction with a BRC-162 output. Every settle tick
 * ends with a release drain, which releases a held txid only once
 * `module.isSettled(txid)`; a `color-guard:held` event from main runs a tick.
 *
 * Storage mode: the guard is installed only on the main-process storage. With
 * remote active storage the remote server would run `internalizeAction` /
 * `createAction` / `sendWith` and broadcast with its own services, so nothing
 * would be held. So:
 * - remote selected at build (`context.localStorageSelected` not true): a
 *   refusing module (no capability, no store, scheduler or drain); every
 *   `p color` request fails with `ColorLocalStorageRequiredError`. It is never
 *   thrown from the factory, so the wallet still opens. Switching to local
 *   later takes effect when the wallet is next opened.
 * - local selected: every `p color` request first awaits
 *   `context.isLocalStorageActive()` (live: a primary-storage switch does not
 *   rebuild the wallet, and `user.activeStorage` may make a backup the active
 *   store) and fails with the same error unless it resolves true; settle ticks
 *   skip `settle()` likewise. The capability and the linkage overlay keys are
 *   synchronous, so they follow the last answer (initially local).
 * A missing, rejecting or non-true predicate counts as remote (fail closed).
 *
 * Lifecycle: the wallet build disposes the previous module before building
 * the next (PermissionQueueManager). `dispose(module)` stops the scheduler
 * (timers and the `online` listener), unsubscribes the held event, drops the
 * host read grants and disposes the module, once.
 */

import {
  ATTESTED_PROFILE_ID,
  createAttestedProfile,
  createColorModule,
  type ColorOverlayProvider,
  type ColorPermissionModule
} from '@bsv/color-permission-module'
import {
  MANDALA_PROFILE_ID,
  createMandalaOverlayProvider,
  createMandalaProfile
} from '@bsv/mandala/profile'
import type { PermissionsModule } from '@bsv/wallet-toolbox-client'
import type { PermissionModuleContext, PermissionModuleDefinition, PermissionModuleFactoryArgs } from './types'
import type { MandalaOverlaySetting } from '../networkConfig'
import { createIpcColorModuleStore } from './color/store'
import { createColorConsentGate } from './color/consentGate'
import { createAssetDisplayResolver, enrichConsentMessage } from './color/assetDisplay'
import { createShipColorProvider } from './color/defaultProvider'
import { startColorSettleScheduler } from './color/settleScheduler'
import { createColorReleaseDrain, type ColorGuardBridge } from './color/releaseDrain'
import { ColorPermissionPrompt } from './color/Prompt'
import { setColorLinkageOverlayKeys } from './color/overlayKeys'

export interface HostColorModuleDeps {
  createColorModule: typeof createColorModule
  createAttestedProfile: typeof createAttestedProfile
  createMandalaProfile: typeof createMandalaProfile
  createMandalaOverlayProvider: typeof createMandalaOverlayProvider
  createStore: typeof createIpcColorModuleStore
  createDefaultProvider: typeof createShipColorProvider
  startScheduler: typeof startColorSettleScheduler
  /** The main-process broadcast guard over IPC; undefined outside Electron. */
  guardBridge: () => ColorGuardBridge | undefined
  createReleaseDrain: typeof createColorReleaseDrain
}

const defaultDeps: HostColorModuleDeps = {
  createColorModule,
  createAttestedProfile,
  createMandalaProfile,
  createMandalaOverlayProvider,
  createStore: createIpcColorModuleStore,
  createDefaultProvider: createShipColorProvider,
  startScheduler: startColorSettleScheduler,
  guardBridge: () => (globalThis as { window?: Window }).window?.electronAPI?.colorGuard,
  createReleaseDrain: createColorReleaseDrain
}

/** module -> its host cleanup; an entry is removed when it runs (once). */
const cleanups = new WeakMap<object, () => void>()

export const COLOR_LOCAL_STORAGE_REQUIRED = 'ERR_COLOR_LOCAL_STORAGE_REQUIRED'

/**
 * A `p color` request while the wallet's active storage is not the local one
 * (contract §8.2: the broadcast guard covers local storage only). The HTTP
 * bridge forwards `name`, `code` and `retryable`.
 */
export class ColorLocalStorageRequiredError extends Error {
  readonly code = COLOR_LOCAL_STORAGE_REQUIRED
  readonly retryable = false
  constructor () {
    super('Colored Tokens need local wallet storage')
    this.name = 'ColorLocalStorageRequiredError'
  }
}

/** The host's view of either module shape: the toolbox hooks plus what the host drives. */
export type HostColorModule = PermissionsModule & {
  settle: ColorPermissionModule['settle']
  isSettled: ColorPermissionModule['isSettled']
  dispose: () => void
}

/**
 * The live storage check, remembering its last answer for the synchronous
 * readers (capability, linkage keys). Never rejects: a missing predicate or a
 * fault means "not local" (fail closed).
 */
function localStorageCheck (context: PermissionModuleContext): { check: () => Promise<boolean>, last: () => boolean } {
  const predicate = (context as Partial<PermissionModuleContext>).isLocalStorageActive
  let last = true
  const check = async (): Promise<boolean> => {
    let local = false
    if (typeof predicate === 'function') {
      try {
        local = (await predicate()) === true
      } catch {
        local = false
      }
    }
    last = local
    return local
  }
  return { check, last: () => last }
}

/** The module built while remote storage is active: it refuses every `p color` request. */
function refusingColorModule (): HostColorModule {
  const refuse = async (): Promise<never> => { throw new ColorLocalStorageRequiredError() }
  const module: HostColorModule = {
    handleRequest: refuse,
    onRequest: refuse,
    onResponse: refuse,
    settle: async () => ({ results: [] }),
    isSettled: async () => false,
    dispose: () => {}
  }
  cleanups.set(module, () => {})
  return module
}

/**
 * The real module, refusing `p color` requests (and advertising no
 * capability) while local storage is not active. `onResponse` passes through:
 * it only finishes a request that `onRequest` already let in. Everything else
 * reaches the module itself.
 */
function storageGuardedModule (module: ColorPermissionModule, storage: ReturnType<typeof localStorageCheck>): HostColorModule {
  const handleRequest: PermissionsModule['handleRequest'] = async (req, next) => {
    if (!(await storage.check())) throw new ColorLocalStorageRequiredError()
    return await module.handleRequest(req, next)
  }
  const onRequest: PermissionsModule['onRequest'] = async req => {
    if (!(await storage.check())) throw new ColorLocalStorageRequiredError()
    return await module.onRequest(req)
  }
  return new Proxy(module, {
    get (target, prop) {
      if (prop === 'handleRequest') return handleRequest
      if (prop === 'onRequest') return onRequest
      // getVersion reads this per call: no BRC-207 capability while refusing.
      if (prop === 'capabilities') return storage.last() ? target.capabilities : {}
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  }) as unknown as HostColorModule
}

/**
 * The configured overlays a provider can be built for, deduplicated by
 * identity key (first row wins), with that provider. `createMandalaOverlayProvider`
 * checks the url and that K is a valid compressed point.
 */
function usableOverlays (
  rows: unknown,
  build: HostColorModuleDeps['createMandalaOverlayProvider']
): Array<{ overlay: MandalaOverlaySetting, provider: ColorOverlayProvider }> {
  if (!Array.isArray(rows)) return []
  const out: Array<{ overlay: MandalaOverlaySetting, provider: ColorOverlayProvider }> = []
  const seen = new Set<string>()
  for (const row of rows) {
    const url = (row as MandalaOverlaySetting | undefined)?.url
    const identityKey = (row as MandalaOverlaySetting | undefined)?.identityKey
    if (typeof url !== 'string' || typeof identityKey !== 'string') {
      console.warn('[color] skipping a malformed Mandala overlay setting')
      continue
    }
    const key = identityKey.toLowerCase()
    if (seen.has(key)) {
      console.warn('[color] skipping a duplicate Mandala overlay for', key)
      continue
    }
    let provider: ColorOverlayProvider
    try {
      provider = build({ url, identityKey })
    } catch (e) {
      console.warn('[color] skipping an invalid Mandala overlay setting', url, e)
      continue
    }
    seen.add(key)
    out.push({ overlay: { url, identityKey }, provider })
  }
  return out
}

export function createHostColorModule (
  args: PermissionModuleFactoryArgs,
  deps?: Partial<HostColorModuleDeps>
): HostColorModule {
  const d: HostColorModuleDeps = { ...defaultDeps, ...deps }
  const { wallet, adminOriginator, promptHandler, context } = args
  if (!context) throw new Error('The 1Color module needs the wallet identity and network')

  if (context.localStorageSelected !== true) {
    console.warn('[color] the wallet uses remote storage; Colored Tokens requests are refused')
    return refusingColorModule()
  }
  const storage = localStorageCheck(context)

  const configured = usableOverlays(context.settings?.mandalaOverlays, d.createMandalaOverlayProvider)
  const overlays = configured.map(c => c.overlay)
  // The holder-send linkage grant uses exactly these keys, and none while
  // requests are refused (remote storage).
  const overlayKeys = overlays.map(o => o.identityKey)

  const store = d.createStore(context.identityKey, context.chain)
  const provider = d.createDefaultProvider({ chain: context.chain })

  // Deploy display metadata: the configured Mandala overlays first, then SHIP.
  const displayProviders: ColorOverlayProvider[] = [...configured.map(c => c.provider), provider]
  const display = createAssetDisplayResolver({ providers: () => displayProviders })

  const gate = createColorConsentGate({
    adminOriginator,
    prompt: promptHandler ?? (async () => false),
    enrich: m => enrichConsentMessage(m, display)
  })

  const module = d.createColorModule({
    wallet,
    provider,
    requestTokenAccess: gate,
    store,
    profiles: {
      [ATTESTED_PROFILE_ID]: d.createAttestedProfile(),
      [MANDALA_PROFILE_ID]: d.createMandalaProfile({ overlays })
    }
  })

  // Without the bridge (not in Electron) nothing is ever released: the guard in
  // main still holds every 1Color broadcast, so this fails closed.
  const guard = d.guardBridge()
  if (!guard) console.warn('[color] broadcast guard bridge unavailable; held 1Color transactions stay held')
  const drain = guard
    ? d.createReleaseDrain({
      isSettled: txid => module.isSettled(txid),
      api: guard,
      identityKey: context.identityKey,
      chain: context.chain
    })
    : undefined

  let scheduler: ReturnType<HostColorModuleDeps['startScheduler']>
  let unsubscribeHeld: () => void = () => {}
  try {
    scheduler = d.startScheduler({
      settle: async () => {
        try {
          // Remote active storage: nothing to settle against until local returns.
          if (!(await storage.check())) return { results: [] }
          return await module.settle(undefined, adminOriginator)
        } finally {
          // Admissions recorded by this settle (and parks it caused through
          // sendWith) are released in the same tick. drain() never rejects.
          if (drain) await drain.drain()
        }
      }
    })
    // A park in main runs a tick now rather than at the next interval; it joins
    // an in-flight tick, whose drain runs after its settle.
    if (guard) unsubscribeHeld = guard.onHeld(() => { void scheduler.runNow() })
  } catch (e) {
    try { scheduler?.stop() } catch { /* already failing */ }
    gate.clear()
    try { module.dispose() } catch { /* already failing */ }
    throw e
  }

  const guarded = storageGuardedModule(module, storage)
  setColorLinkageOverlayKeys(guarded, () => (storage.last() ? overlayKeys : []))
  cleanups.set(guarded, () => {
    setColorLinkageOverlayKeys(guarded, undefined)
    try { unsubscribeHeld() } catch (e) { console.error('[color] held listener removal failed', e) }
    try { scheduler.stop() } catch (e) { console.error('[color] scheduler stop failed', e) }
    gate.clear()
    module.dispose()
  })
  return guarded
}

function disposeHostColorModule (module: unknown): void {
  if (module === null || typeof module !== 'object') return
  const cleanup = cleanups.get(module)
  if (!cleanup) return
  cleanups.delete(module)
  cleanup()
}

export const colorPermissionModule: PermissionModuleDefinition = {
  id: 'color',
  label: '1Color Token Module',
  enabledByDefault: true,
  createModule: createHostColorModule,
  dispose: disposeHostColorModule,
  Prompt: ColorPermissionPrompt
}
