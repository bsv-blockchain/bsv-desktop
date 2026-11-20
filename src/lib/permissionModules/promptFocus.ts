/**
 * Window focus around a module's permission prompt, without React.
 *
 * Focus is checked once per burst of requests: the first `ensure()` records
 * whether the window was focused and asks for focus if it was not. When the
 * queue empties, `relinquish()` gives focus back only if this burst took it.
 *
 * Calls run one after another: an `ensure()` that starts while a hand-back is
 * in flight neither checks nor asks for focus until that hand-back has
 * settled, so the next request's dialog is not put behind the previous app.
 * A callback that throws is logged; it never rejects a call or stops later
 * ones.
 */

export type PromptFocusCallbacks = {
  isFocused: () => Promise<boolean>
  onFocusRequested: () => Promise<void>
  onFocusRelinquished: () => Promise<void>
}

export type PromptFocus = {
  /** Before showing a request: waits for any hand-back, then takes focus for a new burst. */
  ensure: () => Promise<void>
  /** When the queue empties: gives focus back if this burst took it. */
  relinquish: () => Promise<void>
}

export function createPromptFocus (cb: PromptFocusCallbacks): PromptFocus {
  let tail: Promise<void> = Promise.resolve()
  /** The current burst; `wasFocused` stays undefined if the check failed. */
  let burst: { wasFocused?: boolean } | null = null

  const serialized = (step: () => Promise<void>, failure: string): Promise<void> => {
    const run = tail.then(step).catch(error => { console.error(failure, error) })
    tail = run
    return run
  }

  return {
    ensure: () => serialized(async () => {
      if (burst !== null) return
      const current: { wasFocused?: boolean } = {}
      burst = current
      current.wasFocused = await cb.isFocused()
      if (!current.wasFocused) await cb.onFocusRequested()
    }, 'Unable to focus the permission prompt'),
    relinquish: () => serialized(async () => {
      const ended = burst
      burst = null
      if (ended?.wasFocused === false) await cb.onFocusRelinquished()
    }, 'Unable to restore focus after the permission prompt')
  }
}
