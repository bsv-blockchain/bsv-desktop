/**
 * Periodic settlement for the host Mandala runtime (D17, design §9 B7).
 *
 * Runs `settle` (the runtime tick: MessageBox receive, `settleReceipts` →
 * `markSettled`, then the broadcast-guard drain) once shortly after the
 * wallet opens, every 5 minutes while it is open, and whenever the window
 * comes back `online`. It never throws for overlay refusals.
 *
 * Robustness:
 * - single-flight: every trigger (initial timer, interval, `online`, runNow)
 *   joins the in-flight run instead of queueing another;
 * - nothing escapes: a rejecting or synchronously throwing `settle`, and a
 *   throwing `onReport`/`onError`, never reject `runNow` or an interval tick;
 * - `stop()` (wallet close / rebuild) clears both timers and the `online`
 *   listener, ignores a result that lands after it, starts no new run, and is
 *   idempotent.
 *
 * Local structural types only: this file does not import the color module.
 */

export const SETTLE_INTERVAL_MS = 300_000
export const SETTLE_INITIAL_DELAY_MS = 1_000

/** Structurally `{ results: ReceiptSettleResult[] }` of `settleReceipts`. */
export type SettleReportLike = {
  results: Array<{
    txid: string
    assetId: string
    status: 'admitted' | 'retry' | 'refused'
    code?: string
    description?: string
  }>
}

export interface ColorSettleSchedulerOptions {
  settle: () => Promise<SettleReportLike>
  intervalMs?: number
  initialDelayMs?: number
  /** Defaults to `window` when there is one. */
  events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
  onReport?: (r: SettleReportLike) => void
  onError?: (e: unknown) => void
}

export interface ColorSettleScheduler {
  stop(): void
  runNow(): Promise<void>
}

function defaultOnReport (r: SettleReportLike): void {
  const results = Array.isArray(r?.results) ? r.results : []
  for (const result of results) {
    if (result?.status === 'refused') {
      console.warn('[color] settle refused', result.txid, result.code)
    }
  }
}

function defaultOnError (e: unknown): void {
  console.warn('[color] settle failed', e)
}

function validDelay (v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
}

function defaultEvents (): Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | undefined {
  return typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : undefined
}

export function startColorSettleScheduler (o: ColorSettleSchedulerOptions): ColorSettleScheduler {
  const settle = o.settle
  const intervalMs = validDelay(o.intervalMs, SETTLE_INTERVAL_MS) || SETTLE_INTERVAL_MS
  const initialDelayMs = validDelay(o.initialDelayMs, SETTLE_INITIAL_DELAY_MS)
  const events = o.events ?? defaultEvents()
  const onReport = o.onReport ?? defaultOnReport
  const onError = o.onError ?? defaultOnError

  let stopped = false
  let inFlight: Promise<void> | null = null
  let initialTimer: ReturnType<typeof setTimeout> | null = null
  let intervalTimer: ReturnType<typeof setInterval> | null = null

  const reportError = (e: unknown): void => {
    if (stopped) return
    try { onError(e) } catch { /* a failing logger must not break the scheduler */ }
  }

  const run = (): Promise<void> => {
    if (inFlight) return inFlight
    if (stopped) return Promise.resolve()
    const p = Promise.resolve()
      .then(() => settle())
      .then(
        (report) => {
          if (stopped) return
          try { onReport(report) } catch (e) { reportError(e) }
        },
        (e) => { reportError(e) }
      )
      .finally(() => {
        if (inFlight === p) inFlight = null
      })
    inFlight = p
    return p
  }

  const trigger = (): void => { void run() }

  initialTimer = setTimeout(() => {
    initialTimer = null
    if (stopped) return
    intervalTimer = setInterval(trigger, intervalMs)
    trigger()
  }, initialDelayMs)

  events?.addEventListener('online', trigger)

  return {
    stop (): void {
      if (stopped) return
      stopped = true
      if (initialTimer !== null) { clearTimeout(initialTimer); initialTimer = null }
      if (intervalTimer !== null) { clearInterval(intervalTimer); intervalTimer = null }
      try { events?.removeEventListener('online', trigger) } catch { /* detached target */ }
    },
    runNow: run
  }
}
