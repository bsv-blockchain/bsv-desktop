/**
 * Turns monitor-observed transaction status changes (Arcade SSE events among
 * them) into the renderer's window events, so balances and activity lists
 * refresh as a change happens instead of on their next poll.
 *
 * `balance-changed` is the event views already listen to; `tx-status-changed`
 * is for views that show per-transaction status. Bursts (a block mining several
 * of the wallet's transactions at once) are coalesced into one refresh.
 */

export const TX_STATUS_CHANGED_EVENT = 'tx-status-changed'

const COALESCE_MS = 250

let unsubscribe: (() => void) | undefined

export function installTxStatusBridge(target: Window = window): void {
  if (unsubscribe) return
  const subscribe = target.electronAPI?.onTxStatusChanged
  if (typeof subscribe !== 'function') return

  let timer: ReturnType<typeof setTimeout> | undefined
  unsubscribe = subscribe(() => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      target.dispatchEvent(new CustomEvent('balance-changed'))
      target.dispatchEvent(new CustomEvent(TX_STATUS_CHANGED_EVENT))
    }, COALESCE_MS)
  })
}

/** For tests. */
export function uninstallTxStatusBridge(): void {
  unsubscribe?.()
  unsubscribe = undefined
}
