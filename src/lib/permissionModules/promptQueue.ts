/**
 * The queue behind a module's permission prompt, without React: requests are
 * shown one at a time in arrival order, so concurrent app calls never replace
 * an unanswered request.
 *
 * Each entry gets a fresh id, and a decision names the id of the entry it was
 * made for: a decision for any other entry is ignored. An approval is also
 * ignored until `armDelayMs` have passed since the shown entry appeared and
 * since the last decision recorded on the queue's `PromptClock`; a denial
 * never is. Each entry is decided once.
 *
 * Queues that share a clock share that second condition: a decision in any
 * of them restarts the delay for the entry shown in every other. The module
 * prompts all use `modulePromptClock`.
 */

/** When the last decision was made in any queue that uses this clock. */
export type PromptClock = {
  /** The time of the last decision, on the queues' `now` scale; -Infinity before the first. */
  lastDecisionAt: () => number
  /** Records a decision made at `at`, and tells every subscriber. */
  stamp: (at: number) => void
  /** Calls `listener` after every stamp; returns the unsubscribe function. */
  subscribe: (listener: () => void) => () => void
}

export function createPromptClock (): PromptClock {
  let last = -Infinity
  const listeners = new Set<() => void>()
  return {
    lastDecisionAt: () => last,
    stamp (at) {
      last = Math.max(last, at)
      for (const listener of [...listeners]) listener()
    },
    subscribe (listener) {
      const own = (): void => listener()
      listeners.add(own)
      return () => { listeners.delete(own) }
    }
  }
}

/** The one clock every module permission prompt's queue uses. */
export const modulePromptClock: PromptClock = createPromptClock()

export type PromptQueueEntry<V> = { id: number, app: string, view: V }

export type PromptQueue<V> = {
  /** Queues a request; resolves with the decision for this entry. */
  enqueue: (app: string, view: V) => Promise<boolean>
  /** The entry on screen, or null; the same object until it is decided. */
  current: () => PromptQueueEntry<V> | null
  /** True once `armDelayMs` have passed since the current entry was shown and since the clock's last decision. */
  armed: () => boolean
  /** Milliseconds until the current entry is armed; 0 when armed or when nothing is shown. */
  msUntilArmed: () => number
  /** Decides entry `id` if it is the current one; an approval only once armed. */
  decide: (id: number, allowed: boolean) => void
  /** Resolves the current entry and every queued entry `false`; a shown entry counts as a decision on the clock. */
  clear: () => void
}

/** How long a request is on screen, and how long after any decision, before it can be approved. */
export const PROMPT_ARM_DELAY_MS = 600

type Pending<V> = { entry: PromptQueueEntry<V>, resolve: (allowed: boolean) => void }

export function createPromptQueue<V> (o: {
  armDelayMs: number
  now: () => number
  onChange: () => void
  /** The decision clock; a queue without one gets its own. */
  clock?: PromptClock
}): PromptQueue<V> {
  const clock = o.clock ?? createPromptClock()
  let nextId = 1
  const waiting: Array<Pending<V>> = []
  let shown: (Pending<V> & { shownAt: number }) | null = null

  /** Shows the next waiting entry when nothing is shown; true if it did. */
  const showNext = (): boolean => {
    if (shown !== null) return false
    const next = waiting.shift()
    if (next === undefined) return false
    shown = { ...next, shownAt: o.now() }
    return true
  }

  const msUntilArmed = (): number => shown === null
    ? 0
    : Math.max(0, Math.max(shown.shownAt, clock.lastDecisionAt()) + o.armDelayMs - o.now())
  const armed = (): boolean => shown !== null && msUntilArmed() === 0

  return {
    enqueue (app, view) {
      return new Promise<boolean>(resolve => {
        waiting.push({ entry: { id: nextId++, app, view }, resolve })
        if (showNext()) o.onChange()
      })
    },
    current: () => shown?.entry ?? null,
    armed,
    msUntilArmed,
    decide (id, allowed) {
      if (shown === null || shown.entry.id !== id) return
      if (allowed && !armed()) return
      const decided = shown
      shown = null
      showNext()
      decided.resolve(allowed)
      o.onChange()
      clock.stamp(o.now())
    },
    clear () {
      const wasShowing = shown !== null
      const all = [...(shown === null ? [] : [shown]), ...waiting.splice(0)]
      shown = null
      for (const pending of all) pending.resolve(false)
      o.onChange()
      if (wasShowing) clock.stamp(o.now())
    }
  }
}
