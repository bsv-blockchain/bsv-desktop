import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletPermissionsManager } from '@bsv/wallet-toolbox-client'

vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('@bsv/btms-permission-module-ui', () => ({ BtmsPermissionPrompt: () => null }))

import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'

const noFunds = Object.assign(new Error('Insufficient funds in the available inputs to cover the cost of the required outputs'), { code: 'WERR_INSUFFICIENT_FUNDS' })
const app = 'zanaadu.com'
const peer = `02${'cd'.repeat(32)}`
const protocolRequest = (requestID: string) => ({
  type: 'protocol' as const,
  requestID,
  originator: app,
  privileged: false,
  protocolID: [2, 'auth message signature'] as any,
  counterparty: peer,
  reason: 'sign in',
})

function setup() {
  const queue = new PermissionQueueManager()
  queue.adminOriginator = 'admin.example.com'
  queue.permissionsConfig = {} as any
  const pm: any = queue.createPermissionsManager({} as any)
  const grant = vi.spyOn(WalletPermissionsManager.prototype, 'grantPermission').mockResolvedValue(undefined)
  return { queue, pm, grant }
}

beforeEach(() => vi.stubGlobal('window', {}))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('grants an empty wallet cannot save (#115)', () => {
  it('are honored for the session instead of asking again', async () => {
    const { queue, grant } = setup()
    await queue.protocolPermissionCallback(protocolRequest('r1'))
    expect(queue.getSnapshot().protocolRequests).toHaveLength(1)

    const message = queue.noteGrantFailure('r1', noFunds)
    expect(message).toMatch(/no funds/)
    queue.advanceProtocolQueue()

    await queue.protocolPermissionCallback(protocolRequest('r2'))
    expect(queue.getSnapshot().protocolRequests).toHaveLength(0)
    expect(grant).toHaveBeenCalledWith({ requestID: 'r2', ephemeral: true })
  })

  it('still asks again after other failures', async () => {
    const { queue, grant } = setup()
    await queue.protocolPermissionCallback(protocolRequest('r1'))
    queue.noteGrantFailure('r1', new Error('network down'))
    queue.advanceProtocolQueue()

    await queue.protocolPermissionCallback(protocolRequest('r2'))
    expect(queue.getSnapshot().protocolRequests).toHaveLength(1)
    expect(grant).not.toHaveBeenCalled()
  })

  it('lets a counterparty grant that failed to save through on retry, and covers the signature call', async () => {
    const dismiss = vi.spyOn(WalletPermissionsManager.prototype, 'dismissGroupedPermission').mockResolvedValue(undefined)
    const { queue, grant } = setup()
    const request = { requestID: 'pact-1', originator: app, counterparty: peer, permissions: { protocols: [{ protocolName: 'auth message signature', description: 'sign in' }] } }
    await queue.counterpartyPermissionCallback(request as any)
    expect(queue.getSnapshot().counterpartyPermissionRequests).toHaveLength(1)

    queue.noteGroupGrantFailure({ originator: app, counterparty: peer }, { protocolPermissions: request.permissions.protocols }, noFunds)
    queue.advanceCounterpartyPermissionQueue()

    await queue.counterpartyPermissionCallback({ ...request, requestID: 'pact-2' } as any)
    expect(queue.getSnapshot().counterpartyPermissionRequests).toHaveLength(0)
    expect(dismiss).toHaveBeenCalledWith('pact-2')

    await queue.protocolPermissionCallback(protocolRequest('r3'))
    expect(grant).toHaveBeenCalledWith({ requestID: 'r3', ephemeral: true })
  })

  it('releases the group gate when a grouped grant fails', async () => {
    vi.spyOn(WalletPermissionsManager.prototype, 'grantGroupedPermission').mockRejectedValue(noFunds)
    const { queue, pm } = setup()
    const release = vi.spyOn(queue as any, '_releaseDeferredAfterGroup').mockResolvedValue(undefined)
    ;(queue as any)._groupRequestCooldownKeyById.set('g1', 'key')

    await expect(pm.grantGroupedPermission({ requestID: 'g1', granted: { protocolPermissions: [] } })).rejects.toThrow(/Insufficient funds/)
    expect(release).toHaveBeenCalledOnce()
    expect((queue as any)._isGroupCooldownActive('key')).toBe(true)
  })

  it('forgets session grants when the wallet changes', async () => {
    const { queue } = setup()
    await queue.protocolPermissionCallback(protocolRequest('r1'))
    queue.noteGrantFailure('r1', noFunds)
    queue.advanceProtocolQueue()
    queue.createPermissionsManager({} as any)

    await queue.protocolPermissionCallback(protocolRequest('r2'))
    expect(queue.getSnapshot().protocolRequests).toHaveLength(1)
  })
})
