import type { WalletInterface, WalletAction } from '@bsv/sdk'

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
