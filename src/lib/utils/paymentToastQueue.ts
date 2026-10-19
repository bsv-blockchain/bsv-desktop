/**
 * Coalesces "you were paid" toasts. The first arrival is shown at once; arrivals within
 * `windowMs` after it are folded into that same toast, which is replaced by a summary
 * ("You were paid 3 times · 12,000 sats") covering all of them, so a burst never stacks a toast
 * per payment. Pure (no React), so the PaymentToasts component stays thin.
 *
 * `show(text)` shows a new toast and returns a handle for it; `show(text, handle)` replaces the
 * toast with that handle (or shows a new one if it is gone).
 */
import { formatSatoshis } from '../components/AmountDisplay/amountFormatHelpers'

export type PaidToast = { amount: number; from: string; live: boolean }

const defaultFormat = (sats: number) => formatSatoshis(sats, false, true, null, 'SATS')

export function createToastQueue(show: (text: string, replace?: unknown) => unknown, windowMs = 3000, format: (sats: number) => string = defaultFormat): { push(p: PaidToast): void; flush(): void } {
  let open: { handle: unknown; count: number; total: number } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Ends the window: the next arrival gets a toast of its own. */
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    open = null
  }
  return {
    push(p) {
      if (open) {
        open.count++
        open.total += p.amount
        open.handle = show(`You were paid ${open.count} times · ${format(open.total)}`, open.handle) ?? open.handle
        return
      }
      const handle = show(`You were paid ${format(p.amount)} · from ${p.from}${p.live ? ' · live' : ''}`)
      open = { handle, count: 1, total: p.amount }
      timer = setTimeout(flush, windowMs)
    },
    flush
  }
}
