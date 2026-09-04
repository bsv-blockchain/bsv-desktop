import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import { arcadeUrl } from './endpoints.js'

export type FeeChain = 'main' | 'test' | 'ttn'

export interface FeeSettingsView {
  chain: FeeChain
  customRate: number | null
  effectiveRate: number
  floorRate: number | null
  policyUrl: string
  policyError?: string
  restartRequired: boolean
}

export interface FeeSettingsFile {
  main?: number | null
  test?: number | null
  ttn?: number | null
}

export interface PolicyResponse {
  ok: boolean
  status?: number
  json: () => Promise<unknown>
}

export type PolicyFetch = (
  url: string,
  options?: { method?: string; signal?: AbortSignal; cache?: 'no-store' }
) => Promise<PolicyResponse>

export interface FeeSettingsServiceOptions {
  settingsPath?: string
  fetch?: PolicyFetch
  timeoutMs?: number
}

export const DEFAULT_STORAGE_FEE_RATE = 250
export const DEFAULT_MONITOR_FEE_RATE = 100
export const POLICY_TIMEOUT_MS = 5_000

const CHAINS: readonly FeeChain[] = ['main', 'test', 'ttn']
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER

function isFeeChain(value: unknown): value is FeeChain {
  return typeof value === 'string' && (CHAINS as readonly string[]).includes(value)
}

function assertFeeChain(value: unknown): asserts value is FeeChain {
  if (!isFeeChain(value)) {
    throw new Error('Invalid fee settings chain')
  }
}

/** Validate the positive integer fee rate accepted from the renderer. */
export function validateCustomFeeRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Fee rate must be a finite safe positive integer')
  }
  return value
}

/**
 * Convert an Arcade fee ratio into satoshis per kB with exact integer
 * arithmetic, rejecting a result outside JavaScript's safe integer range.
 */
export function feeRatioToSatPerKb(satoshis: unknown, bytes: unknown): number {
  if (
    typeof satoshis !== 'number' ||
    !Number.isSafeInteger(satoshis) ||
    satoshis < 0
  ) {
    throw new Error('Policy satoshis must be a safe nonnegative integer')
  }
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error('Policy bytes must be a safe positive integer')
  }
  const numerator = BigInt(satoshis) * 1000n
  const denominator = BigInt(bytes)
  const rate = (numerator + denominator - 1n) / denominator
  if (rate > BigInt(MAX_SAFE_INTEGER)) {
    throw new Error('Policy fee rate is outside safe integer range')
  }
  return Number(rate)
}

/** Normalize the `policy.miningFee` shape returned by Arcade. */
export function normalizePolicyFee(payload: unknown): number {
  const root = isRecord(payload) && isRecord(payload.policy) ? payload.policy : payload
  const miningFee = isRecord(root) && isRecord(root.miningFee) ? root.miningFee : undefined
  if (!miningFee) {
    throw new Error('Arcade policy did not include a mining fee')
  }
  return feeRatioToSatPerKb(miningFee.satoshis, miningFee.bytes)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateStoredValue(value: unknown, chain: FeeChain): number | null {
  if (value === null) return null
  try {
    return validateCustomFeeRate(value)
  } catch {
    throw new Error(`Malformed fee settings for chain ${chain}`)
  }
}

/**
 * Parse the nonsecret preferences file. Unknown keys and invalid values are
 * rejected so a damaged file cannot silently alter transaction fees.
 */
export function parseFeeSettingsFile(value: unknown): FeeSettingsFile {
  if (!isRecord(value)) {
    throw new Error('Malformed fee settings file')
  }

  const result: FeeSettingsFile = {}
  for (const [key, storedValue] of Object.entries(value)) {
    if (!isFeeChain(key)) {
      throw new Error(`Malformed fee settings: unknown chain ${key}`)
    }
    result[key] = validateStoredValue(storedValue, key)
  }
  return result
}

/** Pure Node helper used by the main process and monitor startup. */
export function readFeeSettingsFile(settingsPath = defaultFeeSettingsPath()): FeeSettingsFile {
  let raw: string
  try {
    raw = fs.readFileSync(settingsPath, 'utf8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }

  try {
    return parseFeeSettingsFile(JSON.parse(raw))
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      throw new Error('Malformed fee settings file: invalid JSON')
    }
    throw error
  }
}

export function defaultFeeSettingsPath(): string {
  return path.join(os.homedir(), '.bsv-desktop', 'fee-settings.json')
}

// This snapshot is intentionally read once. A preference saved while the app
// is running is picked up by storage and monitor instances only after restart.
const startupFeeSettings = new Map<string, FeeSettingsFile>()

function getStartupFeeSettings(settingsPath = defaultFeeSettingsPath()): FeeSettingsFile {
  const existing = startupFeeSettings.get(settingsPath)
  if (existing) {
    return existing
  }
  const loaded = readFeeSettingsFile(settingsPath)
  startupFeeSettings.set(settingsPath, loaded)
  return loaded
}

function seedStartupFeeSettings(settingsPath: string, settings: FeeSettingsFile): FeeSettingsFile {
  const existing = startupFeeSettings.get(settingsPath)
  if (existing) {
    return existing
  }
  const snapshot = { ...settings }
  startupFeeSettings.set(settingsPath, snapshot)
  return snapshot
}

/** Resolve the process-snapshot rate for a chain, preserving caller defaults. */
export function getConfiguredFeeRate(
  chain: FeeChain,
  fallback: number,
  settingsPath?: string
): number {
  assertFeeChain(chain)
  if (typeof fallback !== 'number' || !Number.isSafeInteger(fallback) || fallback <= 0) {
    throw new Error('Fee fallback must be a finite safe positive integer')
  }
  const configured = getStartupFeeSettings(settingsPath)[chain]
  return configured ?? fallback
}

function defaultPolicyFetch(url: string, options?: { method?: string; signal?: AbortSignal; cache?: 'no-store' }): Promise<PolicyResponse> {
  if (typeof globalThis.fetch !== 'function') {
    return Promise.reject(new Error('Fetch is unavailable'))
  }
  return globalThis.fetch(url, options as any) as unknown as Promise<PolicyResponse>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class FeeSettingsService {
  readonly settingsPath: string
  private readonly policyFetch: PolicyFetch
  private readonly timeoutMs: number
  private readonly initialSettings: FeeSettingsFile
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(options: FeeSettingsServiceOptions = {}) {
    this.settingsPath = options.settingsPath ?? defaultFeeSettingsPath()
    this.policyFetch = options.fetch ?? defaultPolicyFetch
    this.timeoutMs = options.timeoutMs ?? POLICY_TIMEOUT_MS
    this.initialSettings = seedStartupFeeSettings(
      this.settingsPath,
      readFeeSettingsFile(this.settingsPath)
    )
  }

  /** Return current preferences plus a best-effort live policy floor. */
  async get(chain: unknown): Promise<FeeSettingsView> {
    assertFeeChain(chain)
    const settings = readFeeSettingsFile(this.settingsPath)
    const customRate = settings[chain] ?? null
    const policyUrl = `${arcadeUrl(chain)}/policy`

    try {
      const floorRate = await this.fetchPolicyFloor(policyUrl)
      return this.makeView(chain, customRate, floorRate, policyUrl)
    } catch (error) {
      return this.makeView(chain, customRate, null, policyUrl, errorMessage(error))
    }
  }

  /**
   * Save a custom rate only after checking a fresh Arcade policy. Resetting to
   * null is deliberately network-free and therefore always available offline.
   */
  async set(chain: unknown, rate: unknown): Promise<FeeSettingsView> {
    assertFeeChain(chain)
    const customRate = rate === null ? null : validateCustomFeeRate(rate)
    const policyUrl = `${arcadeUrl(chain)}/policy`

    let floorRate: number | null = null
    if (customRate !== null) {
      floorRate = await this.fetchPolicyFloor(policyUrl)
      if (customRate < floorRate) {
        throw new Error(`Fee rate must be at least the live Arcade floor of ${floorRate} sat/kB`)
      }
    }

    const mutation = this.writeQueue.then(async () => {
      const settings = readFeeSettingsFile(this.settingsPath)
      settings[chain] = customRate
      await writeFeeSettingsFile(this.settingsPath, settings)
    })
    // Keep later mutations running if an earlier one fails, while preserving
    // the original failure for the caller that initiated it.
    this.writeQueue = mutation.then(() => undefined, () => undefined)
    await mutation

    // Null resets do not make a network request. The next GET can refresh the
    // floor, while this response remains useful to the settings UI.
    return this.makeView(chain, customRate, floorRate, policyUrl)
  }

  private makeView(
    chain: FeeChain,
    customRate: number | null,
    floorRate: number | null,
    policyUrl: string,
    policyError?: string
  ): FeeSettingsView {
    return {
      chain,
      customRate,
      effectiveRate: customRate ?? DEFAULT_STORAGE_FEE_RATE,
      floorRate,
      policyUrl,
      ...(policyError ? { policyError } : {}),
      restartRequired: customRate !== (this.initialSettings[chain] ?? null)
    }
  }

  private async fetchPolicyFloor(policyUrl: string): Promise<number> {
    const controller = new AbortController()
    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const request = Promise.resolve().then(async () => {
      const response = await this.policyFetch(policyUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      })
      if (!response.ok) {
        throw new Error(`Arcade policy request failed with status ${response.status ?? 'unknown'}`)
      }
      return normalizePolicyFee(await response.json())
    })
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(new Error('Arcade policy request timed out'))
      }, this.timeoutMs)
    })
    try {
      return await Promise.race([request, deadline])
    } catch (error) {
      if (timedOut) {
        throw new Error('Arcade policy request timed out')
      }
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}

async function writeFeeSettingsFile(settingsPath: string, settings: FeeSettingsFile): Promise<void> {
  const directory = path.dirname(settingsPath)
  await fsp.mkdir(directory, { recursive: true })
  const temporaryPath = `${settingsPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fsp.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await fsp.rename(temporaryPath, settingsPath)
  } catch (error) {
    try {
      await fsp.unlink(temporaryPath)
    } catch {
      // Preserve the original write failure.
    }
    throw error
  }
}

export interface IpcMainLike {
  handle: (channel: string, listener: (...args: any[]) => unknown) => void
}

/** Register the small fee API on the existing Electron IPC bridge. */
export function registerFeeSettingsIpc(
  ipcMain: IpcMainLike,
  service: FeeSettingsService
): void {
  ipcMain.handle('fees:get', async (_event, chain: unknown) => service.get(chain))
  ipcMain.handle('fees:set', async (_event, chain: unknown, rate: unknown) => {
    try {
      const settings = await service.set(chain, rate)
      return { success: true, settings }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })
}
