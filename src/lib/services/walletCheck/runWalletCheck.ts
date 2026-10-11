/**
 * Runs the "Troubleshoot" wallet check: one port per step, in order. A step
 * that throws, times out or is skipped never stops the steps after it.
 * Pure — the real ports are built in ./ports.
 */
export type CheckStatus = 'ok' | 'attention' | 'error' | 'skipped'
export type CheckStepId = 'network' | 'connections' | 'transactions' | 'coins' | 'messageBox' | 'payments' | 'backup'
export interface CheckAction { label: string; to: string }
export interface StepOutcome { status: CheckStatus; message: string; fixed?: string[]; action?: CheckAction }

export const CHECK_STEPS: ReadonlyArray<{ id: CheckStepId; title: string }> = [
  { id: 'network', title: 'Blockchain connection' },
  { id: 'connections', title: 'App connections' },
  { id: 'transactions', title: 'Transactions' },
  { id: 'coins', title: 'Coins' },
  { id: 'messageBox', title: 'Message box' },
  { id: 'payments', title: 'Incoming payments' },
  { id: 'backup', title: 'Backup' },
]

export type WalletCheckPorts = Record<CheckStepId, () => Promise<StepOutcome>>
export interface WalletCheckSkips { isSkipped(id: CheckStepId): boolean; whenSkipped(id: CheckStepId): Promise<void> }
export interface WalletCheckCallbacks { onStepStart?(id: CheckStepId): void; onStepDone?(id: CheckStepId, outcome: StepOutcome): void }
export interface WalletCheckResult {
  steps: Partial<Record<CheckStepId, StepOutcome>>
  fixed: string[]
  needsYou: Array<{ id: CheckStepId; message: string; action?: CheckAction }>
  allOk: boolean
  allClear: boolean
}

export const STEP_TIMEOUT_MS = 60_000
const SKIPPED: StepOutcome = { status: 'skipped', message: 'Skipped' }

export async function runWalletCheck(
  ports: WalletCheckPorts,
  callbacks: WalletCheckCallbacks = {},
  skips?: WalletCheckSkips,
  timeoutMs = STEP_TIMEOUT_MS
): Promise<WalletCheckResult> {
  const steps: WalletCheckResult['steps'] = {}
  for (const { id } of CHECK_STEPS) {
    let outcome: StepOutcome
    if (skips?.isSkipped(id)) {
      outcome = SKIPPED
    } else {
      callbacks.onStepStart?.(id)
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<StepOutcome>(resolve => { timer = setTimeout(() => resolve({ status: 'error', message: 'Took too long' }), timeoutMs) })
      const skipped = skips ? skips.whenSkipped(id).then(() => SKIPPED) : new Promise<StepOutcome>(() => {})
      const run = Promise.resolve().then(() => ports[id]()).catch((error: unknown): StepOutcome =>
        ({ status: 'error', message: error instanceof Error ? error.message : String(error) }))
      outcome = await Promise.race([run, timeout, skipped])
      clearTimeout(timer)
    }
    steps[id] = outcome
    callbacks.onStepDone?.(id, outcome)
  }

  const outcomes = CHECK_STEPS.map(({ id }) => ({ id, outcome: steps[id]! }))
  return {
    steps,
    fixed: outcomes.flatMap(({ outcome }) => outcome.fixed ?? []),
    needsYou: outcomes
      .filter(({ outcome }) => outcome.status === 'attention' || outcome.status === 'error')
      .map(({ id, outcome }) => ({ id, message: outcome.message, ...(outcome.action ? { action: outcome.action } : {}) })),
    allOk: outcomes.every(({ outcome }) => outcome.status !== 'error'),
    allClear: outcomes.every(({ outcome }) => outcome.status === 'ok' || outcome.status === 'skipped') &&
      outcomes.some(({ outcome }) => outcome.status === 'ok'),
  }
}
