/**
 * Coalesces "you were paid" toasts: arrivals within `windowMs` of the first one become one
 * toast, so a burst of payments does not stack a toast per payment. Pure (no React), so the
 * PaymentToasts component stays thin.
 */
import { formatSatoshis } from '../components/AmountDisplay/amountFormatHelpers'

export type PaidToast = { amount: number; from: string; live: boolean }

const defaultFormat = (sats: number) => formatSatoshis(sats, false, true, null, 'SATS')

export function createToastQueue(show: (text: string) => void, windowMs = 3000, format: (sats: number) => string = defaultFormat): { push(p: PaidToast): void; flush(): void } {
  let pending: PaidToast[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    const batch = pending
    pending = []
    if (batch.length === 1) {
      const [p] = batch
      show(`You were paid ${format(p.amount)} · from ${p.from}${p.live ? ' · live' : ''}`)
    } else if (batch.length > 1) {
      show(`You were paid ${batch.length} times · ${format(batch.reduce((sum, p) => sum + p.amount, 0))}`)
    }
  }
  return {
    push(p) {
      pending.push(p)
      if (!timer) timer = setTimeout(flush, windowMs)
    },
    flush
  }
}
