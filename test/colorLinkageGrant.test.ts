/**
 * Holder-send linkage grant policy (D20, contract §5 "recipient output").
 *
 * The Mandala lib computes a recipient output's linkage through the app's
 * wallet: one `revealCounterpartyKeyLinkage` toward the overlay key K, gated
 * by the manager as `[2, 'counterparty key linkage revelation <B>']`, and two
 * `encrypt` calls under a per-send random `[2, 'specific linkage revelation 2
 * p color …']` name toward K. With the linkage/encrypt prompts enabled, every
 * send would prompt for a new protocol name. The policy turns one approved
 * `Mandala token sending` prompt into a 30-minute grant per originator
 * (family a) or per (originator, B) (family b).
 *
 * Cases pinned here:
 * - matching: level 2 only, a configured overlay counterparty only, the exact
 *   prefix, a name of at most 310 characters, B a compressed identity key;
 * - `live` per originator and per (originator, B), expiry at 1_800_001 ms, a
 *   clock that moved backwards fails closed, `clear()` drops everything;
 * - `approveColorLinkage`: one approval grants every queued item of that
 *   originator it covers, each ephemerally; a double-click approves once and
 *   the second call throws; a denial grants nothing.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('@bsv/btms-permission-module-ui', () => ({ BtmsPermissionPrompt: () => null }))

import {
  COUNTERPARTY_LINKAGE_PREFIX,
  LINKAGE_GRANT_MS,
  LINKAGE_PROTOCOL_PREFIX,
  createColorLinkageGrantPolicy
} from '../src/lib/permissionModules/color/linkageGrant'
import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'
import type { PermissionModuleContext, PermissionModuleDefinition } from '../src/lib/permissionModules/types'
import { setColorLinkageOverlayKeys } from '../src/lib/permissionModules/color/overlayKeys'

const K = '02798b81951a6a8c7ef8beda09b06a23031d7efaf37b663265e0188ab378124046'
const K2 = '03' + 'cd'.repeat(32)
const B = '02' + 'ab'.repeat(32)
const B2 = '03' + 'ef'.repeat(32)
const NAME = `${LINKAGE_PROTOCOL_PREFIX}${'a'.repeat(64)}v0 41414141 42424242`

const linkage = (originator: string, name = NAME, counterparty: string | undefined = K, level = 2) =>
  ({ originator, protocolID: [level, name] as [number, string], counterparty })
const reveal = (originator: string, b: string, counterparty: string | undefined = K) =>
  linkage(originator, COUNTERPARTY_LINKAGE_PREFIX + b, counterparty)

describe('createColorLinkageGrantPolicy', () => {
  let t = 0
  const policy = (keys: string[] = [K]) => createColorLinkageGrantPolicy({ overlayKeys: () => keys, now: () => t })
  beforeEach(() => { t = 1_000_000 })

  test('constants', () => {
    expect(LINKAGE_PROTOCOL_PREFIX).toBe('specific linkage revelation 2 p color ')
    expect(COUNTERPARTY_LINKAGE_PREFIX).toBe('counterparty key linkage revelation ')
    expect(LINKAGE_GRANT_MS).toBe(1_800_000)
  })

  test('matches level 2 linkage names toward a configured overlay only', () => {
    const p = policy()
    expect(p.matches(linkage('app.example'))).toBe(true)
    expect(p.matches(reveal('app.example', B))).toBe(true)
    // overlay key compared lowercased
    expect(p.matches(linkage('app.example', NAME, K.toUpperCase()))).toBe(true)
    expect(createColorLinkageGrantPolicy({ overlayKeys: () => [K.toUpperCase()] }).matches(linkage('app.example'))).toBe(true)
    // not level 2
    expect(p.matches(linkage('app.example', NAME, K, 1))).toBe(false)
    expect(p.matches(linkage('app.example', NAME, K, 0))).toBe(false)
    // not an overlay counterparty
    expect(p.matches(linkage('app.example', NAME, K2))).toBe(false)
    expect(p.matches(linkage('app.example', NAME, 'self'))).toBe(false)
    expect(p.matches({ ...linkage('app.example'), counterparty: undefined })).toBe(false)
    expect(p.matches(reveal('app.example', B, B))).toBe(false)
    // no overlay configured: never matches
    expect(policy([]).matches(linkage('app.example'))).toBe(false)
    // prefix must be exact (a name that merely contains it does not match)
    expect(p.matches(linkage('app.example', 'x' + NAME))).toBe(false)
    expect(p.matches(linkage('app.example', 'specific linkage revelation 2 p colour x'))).toBe(false)
    expect(p.matches(linkage('app.example', 'p color ' + 'a'.repeat(64)))).toBe(false)
    // length: at most 310 characters (contract §0)
    expect(p.matches(linkage('app.example', LINKAGE_PROTOCOL_PREFIX + 'a'.repeat(310 - LINKAGE_PROTOCOL_PREFIX.length)))).toBe(true)
    expect(p.matches(linkage('app.example', LINKAGE_PROTOCOL_PREFIX + 'a'.repeat(311 - LINKAGE_PROTOCOL_PREFIX.length)))).toBe(false)
    // B must be a compressed lowercase identity key
    expect(p.matches(reveal('app.example', B.toUpperCase()))).toBe(false)
    expect(p.matches(reveal('app.example', '04' + 'ab'.repeat(32)))).toBe(false)
    expect(p.matches(reveal('app.example', B + ' '))).toBe(false)
    expect(p.matches(reveal('app.example', ''))).toBe(false)
    // malformed requests never match and never throw
    expect(p.matches({} as any)).toBe(false)
    expect(p.matches({ originator: 'a', protocolID: 'x' } as any)).toBe(false)
    expect(p.matches(null as any)).toBe(false)
  })

  test('reads the overlay keys on every call (settings apply at once)', () => {
    let keys: string[] = []
    const p = createColorLinkageGrantPolicy({ overlayKeys: () => keys })
    expect(p.matches(linkage('app.example'))).toBe(false)
    keys = [K]
    expect(p.matches(linkage('app.example'))).toBe(true)
  })

  test('family a: one grant per originator covers every linkage name toward K for 30 minutes', () => {
    const p = policy()
    expect(p.live(linkage('app.example'))).toBe(false)
    p.grant(linkage('app.example'))
    expect(p.live(linkage('app.example', `${LINKAGE_PROTOCOL_PREFIX}other names`))).toBe(true)
    // another originator is not covered
    expect(p.live(linkage('other.example'))).toBe(false)
    // a family a grant does not cover counterparty-linkage revelation
    expect(p.live(reveal('app.example', B))).toBe(false)
    // a non-matching request is never live
    expect(p.live(linkage('app.example', NAME, K2))).toBe(false)
    t += LINKAGE_GRANT_MS
    expect(p.live(linkage('app.example'))).toBe(true)
    t += 1
    expect(p.live(linkage('app.example'))).toBe(false)
  })

  test('family b: one grant per (originator, B)', () => {
    const p = policy()
    p.grant(reveal('app.example', B))
    expect(p.live(reveal('app.example', B))).toBe(true)
    expect(p.live(reveal('app.example', B2))).toBe(false)
    expect(p.live(reveal('other.example', B))).toBe(false)
    expect(p.live(linkage('app.example'))).toBe(false)
    t += LINKAGE_GRANT_MS + 1
    expect(p.live(reveal('app.example', B))).toBe(false)
  })

  test('a clock that moved backwards fails closed', () => {
    const p = policy()
    p.grant(linkage('app.example'))
    t -= 1
    expect(p.live(linkage('app.example'))).toBe(false)
  })

  test('grant ignores a request it does not match; clear drops everything', () => {
    const p = policy()
    p.grant(linkage('app.example', NAME, K2))
    expect(p.live(linkage('app.example'))).toBe(false)
    p.grant(linkage('app.example'))
    p.grant(reveal('app.example', B))
    p.clear()
    expect(p.live(linkage('app.example'))).toBe(false)
    expect(p.live(reveal('app.example', B))).toBe(false)
  })
})

describe('PermissionQueueManager.approveColorLinkage', () => {
  const ctx = (overlays: Array<{ url: string, identityKey: string }>): PermissionModuleContext => ({
    identityKey: '02' + '11'.repeat(32),
    chain: 'test',
    settings: { mandalaOverlays: overlays } as any,
    localStorageSelected: true,
    isLocalStorageActive: async () => true
  })
  let queue: PermissionQueueManager
  let pm: { grantPermission: ReturnType<typeof vi.fn>, denyPermission: ReturnType<typeof vi.fn> }
  const colorStandIn: PermissionModuleDefinition = {
    id: 'color',
    label: 'color',
    createModule: ({ context }) => {
      const m = {}
      setColorLinkageOverlayKeys(m, () => (context?.settings.mandalaOverlays ?? []).map(o => o.identityKey))
      return m
    },
    dispose: m => setColorLinkageOverlayKeys(m as object, undefined)
  }

  beforeEach(() => {
    // The group phase arms its grace timer on window; it never fires here.
    vi.stubGlobal('window', { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() })
    queue = new PermissionQueueManager()
    queue.adminOriginator = 'admin.example.com'
    queue.permissionsConfig = {} as any
    // The policy takes its overlay keys from the color module the build made
    // (the validated list), so a stand-in module publishes them.
    queue.enabledPermissionModules = ['color']
    queue.setPermissionsModuleHelpers(id => (id === 'color' ? colorStandIn : undefined), new Map())
    queue.createPermissionsManager({} as any, ctx([{ url: 'https://ov.example', identityKey: K }]))
    pm = { grantPermission: vi.fn(async () => {}), denyPermission: vi.fn(async () => {}) }
    queue.setPermissionsManager(pm)
  })
  afterEach(() => {
    queue.disposePermissionModules()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const request = (requestID: string, r: ReturnType<typeof linkage>) =>
    queue.protocolPermissionCallback({ ...r, type: 'protocol', requestID } as any)

  test('a linkage request is queued flagged and titled Mandala token sending', async () => {
    await request('r1', linkage('app.example'))
    await request('r2', reveal('app.example', B))
    const items = queue.getSnapshot().protocolRequests
    expect(items.map(i => [i.requestID, (i as any).colorLinkage, i.description])).toEqual([
      ['r1', true, 'Mandala token sending'],
      ['r2', true, `Mandala token sending: reveal your link to ${B} to the Mandala overlay`]
    ])
    expect(pm.grantPermission).not.toHaveBeenCalled()
  })

  test('a non-overlay linkage request is an ordinary prompt', async () => {
    await request('r1', linkage('app.example', NAME, K2))
    const [item] = queue.getSnapshot().protocolRequests
    expect((item as any).colorLinkage).toBeUndefined()
    await expect(queue.approveColorLinkage('r1')).rejects.toThrow('Not a Mandala token sending request')
    await expect(queue.approveColorLinkage('nope')).rejects.toThrow('Not a Mandala token sending request')
  })

  test('one approval grants both queued items of the originator ephemerally', async () => {
    await request('r1', linkage('app.example'))
    await request('r2', linkage('app.example', `${LINKAGE_PROTOCOL_PREFIX}${'b'.repeat(64)}v0 43 44`))
    await request('r3', linkage('other.example'))
    await request('r4', reveal('app.example', B))
    await queue.approveColorLinkage('r1')
    expect(pm.grantPermission.mock.calls.map(c => c[0])).toEqual([
      { requestID: 'r1', ephemeral: true },
      { requestID: 'r2', ephemeral: true }
    ])
    // the auto-granted sibling left the queue; the approved one is advanced by the UI
    expect(queue.getSnapshot().protocolRequests.map(i => i.requestID)).toEqual(['r1', 'r3', 'r4'])
    // a later request of that originator is granted with no queue item
    await request('r5', linkage('app.example', `${LINKAGE_PROTOCOL_PREFIX}fresh`))
    expect(pm.grantPermission).toHaveBeenLastCalledWith({ requestID: 'r5', ephemeral: true })
    expect(queue.getSnapshot().protocolRequests.map(i => i.requestID)).toEqual(['r1', 'r3', 'r4'])
  })

  test('double-click approves once; the second call throws', async () => {
    await request('r1', linkage('app.example'))
    const first = queue.approveColorLinkage('r1')
    const second = queue.approveColorLinkage('r1')
    await expect(first).resolves.toBeUndefined()
    await expect(second).rejects.toThrow('Not a Mandala token sending request')
    expect(pm.grantPermission).toHaveBeenCalledTimes(1)
  })

  test('a sibling that was already settled does not fail the approval', async () => {
    await request('r1', linkage('app.example'))
    await request('r2', linkage('app.example', `${LINKAGE_PROTOCOL_PREFIX}x`))
    pm.grantPermission.mockImplementation(async ({ requestID }: { requestID: string }) => {
      if (requestID === 'r2') throw new Error('Request ID not found.')
    })
    await expect(queue.approveColorLinkage('r1')).resolves.toBeUndefined()
    expect(queue.getSnapshot().protocolRequests.map(i => i.requestID)).toEqual(['r1'])
  })

  test('a failed grant of the approved request grants nothing', async () => {
    await request('r1', linkage('app.example'))
    pm.grantPermission.mockRejectedValueOnce(new Error('Request ID not found.'))
    await expect(queue.approveColorLinkage('r1')).rejects.toThrow('Request ID not found.')
    await request('r2', linkage('app.example'))
    expect(queue.getSnapshot().protocolRequests.map(i => i.requestID)).toEqual(['r1', 'r2'])
  })

  test('a denial grants nothing', async () => {
    await request('r1', linkage('app.example'))
    await pm.denyPermission('r1')
    queue.advanceProtocolQueue()
    await request('r2', linkage('app.example'))
    expect(pm.grantPermission).not.toHaveBeenCalled()
    expect(queue.getSnapshot().protocolRequests.map(i => i.requestID)).toEqual(['r2'])
  })

  test('disposePermissionModules drops the grants and the pending linkage requests', async () => {
    await request('r1', linkage('app.example'))
    await queue.approveColorLinkage('r1')
    queue.advanceProtocolQueue()
    await request('r0', linkage('other.example'))
    queue.disposePermissionModules()
    // the pending request of the old wallet can no longer be approved as a linkage grant
    await expect(queue.approveColorLinkage('r0')).rejects.toThrow('Not a Mandala token sending request')
    // the grant is gone: app.example prompts again
    await request('r2', linkage('app.example'))
    expect(queue.getSnapshot().protocolRequests.map(i => i.requestID)).toEqual(['r0', 'r2'])
    expect(pm.grantPermission).toHaveBeenCalledTimes(1)
  })

  test('overlay keys come from the color module, not from settings', async () => {
    // a build without the color module: the configured overlay grants nothing
    queue.enabledPermissionModules = []
    queue.createPermissionsManager({} as any, ctx([{ url: 'https://ov.example', identityKey: K }]))
    queue.setPermissionsManager(pm)
    await request('r1', linkage('app.example'))
    expect((queue.getSnapshot().protocolRequests[0] as any).colorLinkage).toBeUndefined()
  })

  test('without a wallet context no linkage request matches', async () => {
    queue.createPermissionsManager({} as any)
    queue.setPermissionsManager(pm)
    await request('r1', linkage('app.example'))
    expect((queue.getSnapshot().protocolRequests[0] as any).colorLinkage).toBeUndefined()
  })

  test('a linkage request during a pending group is deferred with its flag', async () => {
    await queue.groupPermissionCallback({ requestID: 'g1', originator: 'app.example', permissions: { protocolPermissions: [{ protocolID: [2, 'x'] }] } as any })
    await request('r1', linkage('app.example'))
    expect(queue.getSnapshot().protocolRequests).toEqual([])
    // approving the deferred item still works (it is known to the queue)
    await queue.approveColorLinkage('r1')
    expect(pm.grantPermission).toHaveBeenCalledWith({ requestID: 'r1', ephemeral: true })
  })
})
