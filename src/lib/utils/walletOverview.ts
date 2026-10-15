import type { WalletInterface, WalletAction } from '@bsv/sdk'

/** Read every page, and fail visibly if a provider stops making progress. */
export async function readWalletBalance(wallet: Pick<WalletInterface, 'listOutputs'>, originator: string): Promise<number> {
  let offset = 0
  let balance = 0
  const limit = 1000
  for (;;) {
    const page = await wallet.listOutputs({ basket: 'default', limit, offset }, originator)
    for (const output of page.outputs) {
      if (!Number.isSafeInteger(output.satoshis) || output.satoshis < 0) throw new Error('The wallet returned an invalid output amount.')
      balance += output.satoshis
    }
    offset += page.outputs.length
    if (offset >= page.totalOutputs) return balance
    if (!page.outputs.length) throw new Error('The wallet did not return all balance outputs. Refresh to try again.')
  }
}

export async function readRecentActions(wallet: Pick<WalletInterface, 'listActions'>, originator: string, limit = 30): Promise<{ actions: WalletAction[]; totalActions: number }> {
  const pageSize = Math.min(1000, Math.max(1, Math.floor(limit)))
  const first = await wallet.listActions({ labels: [], limit: pageSize, offset: 0 }, originator)
  const offset = Math.max(0, first.totalActions - Math.max(1, Math.floor(limit)))
  if (offset === 0 && first.actions.length >= first.totalActions) return { actions: [...first.actions].reverse(), totalActions: first.totalActions }
  let nextOffset = offset
  let totalActions = first.totalActions
  const actions: WalletAction[] = []
  while (nextOffset < first.totalActions) {
    const page = nextOffset === 0 ? first : await wallet.listActions({ labels: [], limit: Math.min(pageSize, first.totalActions - nextOffset), offset: nextOffset }, originator)
    if (!page.actions.length) throw new Error('The wallet did not return all requested activity. Refresh to try again.')
    actions.push(...page.actions)
    nextOffset += page.actions.length
    totalActions = page.totalActions
  }
  return { actions: actions.reverse(), totalActions }
}
