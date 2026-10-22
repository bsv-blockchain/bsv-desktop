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
import type { PermissionModuleDefinition, PermissionModuleFactoryArgs } from './types'
import type { MandalaOverlaySetting } from '../networkConfig'
import { createIpcColorModuleStore } from './color/store'
import { createColorConsentGate } from './color/consentGate'
import { createAssetDisplayResolver, enrichConsentMessage } from './color/assetDisplay'
import { createShipColorProvider } from './color/defaultProvider'
import { startColorSettleScheduler } from './color/settleScheduler'
import { createColorReleaseDrain, type ColorGuardBridge } from './color/releaseDrain'
import { ColorPermissionPrompt } from './color/Prompt'

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
): ColorPermissionModule {
  const d: HostColorModuleDeps = { ...defaultDeps, ...deps }
  const { wallet, adminOriginator, promptHandler, context } = args
  if (!context) throw new Error('The 1Color module needs the wallet identity and network')

  const configured = usableOverlays(context.settings?.mandalaOverlays, d.createMandalaOverlayProvider)
  const overlays = configured.map(c => c.overlay)

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

  cleanups.set(module, () => {
    try { unsubscribeHeld() } catch (e) { console.error('[color] held listener removal failed', e) }
    try { scheduler.stop() } catch (e) { console.error('[color] scheduler stop failed', e) }
    gate.clear()
    module.dispose()
  })
  return module
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
