import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletPermissionsManager } from '@bsv/wallet-toolbox-client'

vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('@bsv/btms-permission-module-ui', () => ({ BtmsPermissionPrompt: () => null }))

import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'
import { minimumRaisedLimit, suggestRaisedLimit } from '../src/lib/utils/spendingLimitRaise'

beforeEach(() => vi.stubGlobal('window', {}))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('raising a spending limit from an over-limit payment (#103)', () => {
  it('shows the current limit and what was spent this month', async () => {
    vi.spyOn(WalletPermissionsManager.prototype, 'querySpentSince').mockResolvedValue(900)
    const queue = new PermissionQueueManager()
    queue.adminOriginator = 'admin.example.com'
    queue.permissionsConfig = {} as any
    queue.createPermissionsManager({} as any)

    await queue.spendingAuthorizationCallback({
      type: 'spending', requestID: 's1', originator: 'nubi.example', renewal: true,
      spending: { satoshis: 200 }, previousToken: { authorizedAmount: 1000 },
    } as any)

    expect(queue.getSnapshot().spendingRequests[0]).toMatchObject({
      transactionAmount: 200, authorizationAmount: 200, totalPastSpending: 900, amountPreviouslyAuthorized: 1000,
    })
  })

  it('suggests double the old limit, never less than this payment needs', () => {
    expect(minimumRaisedLimit({ totalPastSpending: 900, authorizationAmount: 200 })).toBe(1100)
    expect(suggestRaisedLimit({ totalPastSpending: 900, authorizationAmount: 200, amountPreviouslyAuthorized: 1000 })).toBe(2000)
    expect(suggestRaisedLimit({ totalPastSpending: 900, authorizationAmount: 5000, amountPreviouslyAuthorized: 1000 })).toBe(5900)
  })
})
