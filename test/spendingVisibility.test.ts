import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletPermissionsManager } from '@bsv/wallet-toolbox-client'

vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('@bsv/btms-permission-module-ui', () => ({ BtmsPermissionPrompt: () => null }))

import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'
import { broadcastSpendingTokensNow } from '../src/lib/services/permissionTokenBroadcast'

beforeEach(() => vi.stubGlobal('window', { setTimeout, clearTimeout }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('spending tokens broadcast immediately (#104)', () => {
  const admin = 'admin.example.com'
  const spendingOutput = { basket: 'admin spending-authorization', satoshis: 1, lockingScript: '00', outputDescription: 'x' }

  it('turns off delayed broadcast for spending-limit tokens, including the signing step of a renewal', async () => {
    const wallet = {
      createAction: vi.fn(async () => ({ signableTransaction: { reference: 'ref-1', tx: [] } })),
      signAction: vi.fn(async () => ({ txid: 'ab' })),
    }
    const wrapped: any = broadcastSpendingTokensNow(wallet as any, admin)
    await wrapped.createAction({ outputs: [spendingOutput], options: { acceptDelayedBroadcast: true, signAndProcess: false } }, admin)
    await wrapped.signAction({ reference: 'ref-1', spends: {}, options: { acceptDelayedBroadcast: true } }, admin)

    expect((wallet.createAction.mock.calls[0] as any)[0].options).toEqual({ acceptDelayedBroadcast: false, signAndProcess: false })
    expect((wallet.signAction.mock.calls[0] as any)[0].options.acceptDelayedBroadcast).toBe(false)
  })

  it('leaves other actions alone', async () => {
    const wallet = { createAction: vi.fn(async () => ({})), signAction: vi.fn(async () => ({})) }
    const wrapped: any = broadcastSpendingTokensNow(wallet as any, admin)
    const protocolToken = { outputs: [{ ...spendingOutput, basket: 'admin protocol-permission' }], options: { acceptDelayedBroadcast: true } }
    await wrapped.createAction(protocolToken, admin)
    const appSpend = { outputs: [spendingOutput], options: { acceptDelayedBroadcast: true } }
    await wrapped.createAction(appSpend, 'app.example.com')
    await wrapped.signAction({ reference: 'other', options: { acceptDelayedBroadcast: true } }, admin)

    expect(wallet.createAction.mock.calls.map((c: any) => c[0])).toEqual([protocolToken, appSpend])
    expect((wallet.signAction.mock.calls[0] as any)[0].options.acceptDelayedBroadcast).toBe(true)
  })
})

describe('requests made while a group prompt is open (#104)', () => {
  it('are answered when the group grant covers them, not dropped', async () => {
    const grant = vi.spyOn(WalletPermissionsManager.prototype, 'grantPermission').mockResolvedValue(undefined)
    vi.spyOn(WalletPermissionsManager.prototype, 'grantGroupedPermission').mockResolvedValue(undefined)
    const queue = new PermissionQueueManager()
    queue.adminOriginator = 'admin.example.com'
    queue.permissionsConfig = {} as any
    const pm: any = queue.createPermissionsManager({} as any)

    await queue.groupPermissionCallback({ requestID: 'g1', originator: 'app.example.com', permissions: { spendingAuthorization: { amount: 1000, description: 'x' } } as any })
    await queue.spendingAuthorizationCallback({ type: 'spending', requestID: 's-small', originator: 'app.example.com', spending: { satoshis: 50 } } as any)
    await queue.spendingAuthorizationCallback({ type: 'spending', requestID: 's-big', originator: 'app.example.com', spending: { satoshis: 5000 } } as any)
    await queue.protocolPermissionCallback({ type: 'protocol', requestID: 'p1', originator: 'app.example.com', protocolID: [1, 'todo'] } as any)

    await pm.grantGroupedPermission({ requestID: 'g1', granted: { spendingAuthorization: { amount: 1000, description: 'x' }, protocolPermissions: [{ protocolID: [1, 'todo'] }] } })

    expect(grant).toHaveBeenCalledWith({ requestID: 's-small', ephemeral: true })
    expect(grant).toHaveBeenCalledWith({ requestID: 'p1', ephemeral: true })
    expect(grant).not.toHaveBeenCalledWith(expect.objectContaining({ requestID: 's-big' }))
    expect(queue.getSnapshot().spendingRequests.map(r => r.requestID)).toEqual(['s-big'])
  })
})
