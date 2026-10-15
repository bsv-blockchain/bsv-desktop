import type { WalletInterface } from '@bsv/sdk'

const SPENDING_BASKET = 'admin spending-authorization'

/**
 * Makes spending-limit tokens broadcast immediately instead of with delayed
 * broadcast.
 *
 * WalletPermissionsManager mints and renews permission tokens with
 * `acceptDelayedBroadcast: true`. Until the monitor sends such a transaction
 * (7-15 s) its outputs are `unprocessed`, which `listOutputs` does not return,
 * so the manager cannot see a spending limit the user has just approved and
 * asks again on the app's first payment (#104). Spending approvals are never
 * cached in memory, unlike other permissions, so only these tokens need this.
 *
 * Wraps the wallet the permissions manager is built on. Renewals create the
 * action unsigned and sign it separately, so the signing call is covered too.
 */
export function broadcastSpendingTokensNow(wallet: WalletInterface, adminOriginator: string): WalletInterface {
  const references = new Set<string>()
  const immediate = (args: any) => ({ ...args, options: { ...(args?.options || {}), acceptDelayedBroadcast: false } })

  return new Proxy(wallet as any, {
    get(target, prop, receiver) {
      if (prop === 'createAction') {
        return async (args: any, originator?: string) => {
          const mintsSpendingToken = originator === adminOriginator &&
            (args?.outputs || []).some((output: any) => output?.basket === SPENDING_BASKET)
          if (!mintsSpendingToken) return target.createAction(args, originator)
          const result = await target.createAction(immediate(args), originator)
          const reference = result?.signableTransaction?.reference
          if (reference) references.add(reference)
          return result
        }
      }
      if (prop === 'signAction') {
        return async (args: any, originator?: string) => {
          if (!references.delete(args?.reference)) return target.signAction(args, originator)
          return target.signAction(immediate(args), originator)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as WalletInterface
}
