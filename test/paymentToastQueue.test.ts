import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToastQueue } from '../src/lib/utils/paymentToastQueue'

// A fixed formatter: the default groups digits by the machine's locale.
const sats = (n: number) => `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')} sats`

/** A fake toast UI: each new toast gets a handle; replacing keeps it. */
function ui() {
  let next = 0
  return vi.fn((_text: string, replace?: unknown) => replace ?? `toast-${++next}`)
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('payment toast queue', () => {
  it('shows a single arrival at once, with its sender, and live when it came directly', () => {
    const show = ui()
    const queue = createToastQueue(show, 3000, sats)
    queue.push({ amount: 5000, from: '@alice', live: true })
    expect(show).toHaveBeenCalledExactlyOnceWith('You were paid 5,000 sats · from @alice · live')

    vi.advanceTimersByTime(3000)
    queue.push({ amount: 120, from: '02abcdef01…9f3c', live: false })
    expect(show).toHaveBeenLastCalledWith('You were paid 120 sats · from 02abcdef01…9f3c')
    expect(show).toHaveBeenCalledTimes(2)
  })

  it('shows the first of a burst of 5 in 1 s at once, then folds all five into that toast with their sum', () => {
    const show = ui()
    const queue = createToastQueue(show, 3000, sats)
    const amounts = [1000, 2000, 3000, 4000, 2000]
    for (const [i, amount] of amounts.entries()) {
      vi.advanceTimersByTime(i ? 200 : 0)
      queue.push({ amount, from: `@p${i}`, live: i % 2 === 0 })
      if (i === 0) expect(show).toHaveBeenCalledExactlyOnceWith('You were paid 1,000 sats · from @p0 · live')
    }
    // One toast: every later call replaces the first.
    expect(show.mock.calls.slice(1).every(([, replace]) => replace === 'toast-1')).toBe(true)
    expect(show).toHaveBeenLastCalledWith('You were paid 5 times · 12,000 sats', 'toast-1')
    expect(amounts.reduce((a, b) => a + b)).toBe(12000)
    vi.advanceTimersByTime(3000)
    expect(show).toHaveBeenCalledTimes(5)
  })

  it('gives an arrival after the window its own toast', () => {
    const show = ui()
    const queue = createToastQueue(show, 3000, sats)
    queue.push({ amount: 1, from: 'a', live: false })
    vi.advanceTimersByTime(2999)
    queue.push({ amount: 2, from: 'b', live: false })
    vi.advanceTimersByTime(1)
    queue.push({ amount: 4, from: 'c', live: false })
    expect(show.mock.calls).toEqual([
      ['You were paid 1 sats · from a'],
      ['You were paid 2 times · 3 sats', 'toast-1'],
      ['You were paid 4 sats · from c']
    ])
  })

  it('flush ends the window', () => {
    const show = ui()
    const queue = createToastQueue(show, 3000, sats)
    queue.flush()
    expect(show).not.toHaveBeenCalled()
    queue.push({ amount: 7, from: 'a', live: false })
    queue.flush()
    queue.push({ amount: 8, from: 'b', live: false })
    expect(show.mock.calls).toEqual([['You were paid 7 sats · from a'], ['You were paid 8 sats · from b']])
  })

  it('formats in sats by default', () => {
    const show = ui()
    createToastQueue(show).push({ amount: 5, from: 'a', live: false })
    expect(show).toHaveBeenCalledWith('You were paid 5 sats · from a')
  })
})
