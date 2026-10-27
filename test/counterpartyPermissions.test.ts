import { KeyDeriver, PrivateKey as EcpmTestPrivateKey } from '@bsv/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { WalletPermissionsManager } from '@bsv/wallet-toolbox-client'

vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('@bsv/btms-permission-module-ui', () => ({ BtmsPermissionPrompt: () => null }))

import { displayProtocols } from '../src/lib/components/CounterpartyPermissionHandler/protocols'
import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'

beforeEach(() => vi.stubGlobal('window', {}))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('counterparty permission prompt', () => {
  it('is mounted with the other permission prompts', () => {
    const ui = fs.readFileSync(path.resolve(__dirname, '../src/lib/UserInterface.tsx'), 'utf8')
    expect(ui).toMatch(/import CounterpartyPermissionHandler from '\.\/components\/CounterpartyPermissionHandler'/)
    expect(ui).toMatch(/<CounterpartyPermissionHandler \/>/)
  })

  it('shows pact protocols by name at level 2 and peer-group protocols by their protocol ID', () => {
    expect(displayProtocols([
      { protocolName: 'chat', description: 'Messages' },
      { protocolID: [2, 'payments'], description: 'Payments' },
      { protocolName: 'ignored', protocolID: [1, 'named by id'] },
      { description: 'no protocol' },
      { protocolID: [2, ''] },
      { protocolID: [2, 'blank'], description: '   ' },
    ])).toEqual([
      { securityLevel: 2, protocolName: 'chat', description: 'Messages' },
      { securityLevel: 2, protocolName: 'payments', description: 'Payments' },
      { securityLevel: 1, protocolName: 'named by id' },
      { securityLevel: 2, protocolName: 'blank' },
    ])
    expect(displayProtocols(undefined)).toEqual([])
  })

  it('shows each manifest description under its protocol with the group reason label', () => {
    const handler = fs.readFileSync(
      path.resolve(__dirname, '../src/lib/components/CounterpartyPermissionHandler/index.tsx'),
      'utf8'
    )
    expect(handler).toMatch(/t\('group_protocol_reason_label'\)/)
    expect(handler).toMatch(/\{p\.description &&/)
    expect(handler).not.toMatch(/<ProtoChip[\s\S]*?description=/)
  })
})

describe('grouped permission grants', () => {
  it('pass the grant through and use it to release deferred requests and start the cooldown', async () => {
    const original = vi.spyOn(WalletPermissionsManager.prototype, 'grantGroupedPermission').mockResolvedValue(undefined)
    const queue = new PermissionQueueManager()
    queue.adminOriginator = 'admin.example.com'
    queue.permissionsConfig = {} as any
    const release = vi.spyOn(queue as any, '_releaseDeferredAfterGroup').mockResolvedValue(undefined)
    const pm: any = queue.createPermissionsManager({ keyDeriver: new KeyDeriver(new EcpmTestPrivateKey(17)) } as any)
    ;(queue as any)._groupRequestCooldownKeyById.set('group-peer:app:false:02ab', 'app|02ab')

    const params = {
      requestID: 'group-peer:app:false:02ab',
      granted: { protocolPermissions: [{ protocolID: [2, 'chat'], counterparty: '02ab' }] },
      expiry: 0,
    }
    await pm.grantGroupedPermission(params)

    expect(original).toHaveBeenCalledWith(params)
    const decision = release.mock.calls[0][0] as any
    expect([...decision.allow.protocols]).toEqual(['chat|02ab'])
    expect((queue as any)._isGroupCooldownActive('app|02ab')).toBe(true)
  })
})
