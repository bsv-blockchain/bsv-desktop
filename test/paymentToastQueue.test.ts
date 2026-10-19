import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToastQueue } from '../src/lib/utils/paymentToastQueue'

// A fixed formatter: the default groups digits by the machine's locale.
const sats = (n: number) => `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')} sats`

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('payment toast queue', () => {
  it('shows a single arrival with its sender, and live when it came directly', () => {
    const show = vi.fn()
    const queue = createToastQueue(show, 3000, sats)
    queue.push({ amount: 5000, from: '@alice', live: true })
    expect(show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(show).toHaveBeenCalledExactlyOnceWith('You were paid 5,000 sats · from @alice · live')

    queue.push({ amount: 120, from: '02abcdef01…9f3c', live: false })
    vi.advanceTimersByTime(3000)
    expect(show).toHaveBeenLastCalledWith('You were paid 120 sats · from 02abcdef01…9f3c')
  })

  it('coalesces a burst of 5 within the window into one toast with the count and sum', () => {
    const show = vi.fn()
    const queue = createToastQueue(show, 3000, sats)
    for (const [i, amount] of [1000, 2000, 3000, 4000, 2000].entries()) {
      vi.advanceTimersByTime(i ? 200 : 0)
      queue.push({ amount, from: `@p${i}`, live: i % 2 === 0 })
    }
    vi.advanceTimersByTime(3000)
    expect(show).toHaveBeenCalledExactlyOnceWith('You were paid 5 times · 12,000 sats')
  })

  it('starts a new window after a toast is shown', () => {
    const show = vi.fn()
    const queue = createToastQueue(show, 3000, sats)
    queue.push({ amount: 1, from: 'a', live: false })
    vi.advanceTimersByTime(3000)
    queue.push({ amount: 2, from: 'b', live: false })
    vi.advanceTimersByTime(3000)
    expect(show.mock.calls.map(c => c[0])).toEqual(['You were paid 1 sats · from a', 'You were paid 2 sats · from b'])
  })

  it('flush shows what is waiting at once, and nothing when empty', () => {
    const show = vi.fn()
    const queue = createToastQueue(show, 3000, sats)
    queue.flush()
    expect(show).not.toHaveBeenCalled()
    queue.push({ amount: 7, from: 'a', live: false })
    queue.push({ amount: 8, from: 'b', live: false })
    queue.flush()
    expect(show).toHaveBeenCalledExactlyOnceWith('You were paid 2 times · 15 sats')
    vi.advanceTimersByTime(3000)
    expect(show).toHaveBeenCalledOnce()
  })

  it('formats in sats by default', () => {
    const show = vi.fn()
    const queue = createToastQueue(show)
    queue.push({ amount: 5, from: 'a', live: false })
    vi.advanceTimersByTime(3000)
    expect(show).toHaveBeenCalledWith('You were paid 5 sats · from a')
  })
})
