import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FeeSettingsService,
  feeRatioToSatPerKb,
  getConfiguredFeeRate,
  normalizePolicyFee,
  parseFeeSettingsFile,
  registerFeeSettingsIpc,
  type PolicyFetch
} from '../electron/feeSettings.js'

const policy = (satoshis: number, bytes: number) => ({
  policy: { miningFee: { satoshis, bytes } }
})

function okFetch(payload: unknown, calls: string[] = []): PolicyFetch {
  return async (url) => {
    calls.push(url)
    return { ok: true, status: 200, json: async () => payload }
  }
}

async function temporarySettingsPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bsv-desktop-fees-'))
  return path.join(directory, 'fee-settings.json')
}

const temporaryPaths: string[] = []
afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(async settingsPath => {
    await rm(path.dirname(settingsPath), { recursive: true, force: true })
  }))
})

describe('Arcade fee policy normalization', () => {
  it('rounds a non-1000-byte policy ratio up to sat/kB', () => {
    expect(normalizePolicyFee(policy(1, 3))).toBe(334)
    expect(feeRatioToSatPerKb(250, 2_000)).toBe(125)
  })

  it('accepts a zero policy floor', () => {
    expect(normalizePolicyFee(policy(0, 1_000))).toBe(0)
  })

  it('rejects malformed ratios and unsafe overflow', () => {
    expect(() => feeRatioToSatPerKb(-1, 1_000)).toThrow()
    expect(() => feeRatioToSatPerKb(1, 0)).toThrow()
    expect(() => feeRatioToSatPerKb(1.5, 1_000)).toThrow()
    expect(() => feeRatioToSatPerKb(Number.MAX_SAFE_INTEGER, 1)).toThrow(/safe integer/)
    expect(() => normalizePolicyFee({ policy: { miningFee: { satoshis: 1, bytes: 0 } } })).toThrow()
  })
})

describe('FeeSettingsService', () => {
  it('returns settings with a null floor when the live policy is unavailable', async () => {
    const settingsPath = await temporarySettingsPath()
    temporaryPaths.push(settingsPath)
    const service = new FeeSettingsService({
      settingsPath,
      fetch: async () => { throw new Error('offline') }
    })

    await expect(service.get('main')).resolves.toMatchObject({
      chain: 'main',
      customRate: null,
      effectiveRate: 250,
      floorRate: null,
      policyError: 'offline',
      restartRequired: false
    })
  })

  it('bounds policy fetches even when an injected fetcher ignores abort', async () => {
    const settingsPath = await temporarySettingsPath()
    temporaryPaths.push(settingsPath)
    const service = new FeeSettingsService({
      settingsPath,
      timeoutMs: 10,
      fetch: async () => new Promise(() => undefined)
    })

    await expect(service.set('main', 500)).rejects.toThrow('timed out')
  })

  it('bounds a stalled policy response body as well', async () => {
    const settingsPath = await temporarySettingsPath()
    temporaryPaths.push(settingsPath)
    const service = new FeeSettingsService({
      settingsPath,
      timeoutMs: 10,
      fetch: async () => ({ ok: true, status: 200, json: async () => new Promise(() => undefined) })
    })

    await expect(service.set('main', 500)).rejects.toThrow('timed out')
  })

  it('rejects a custom rate below the fresh floor without changing preferences', async () => {
    const settingsPath = await temporarySettingsPath()
    temporaryPaths.push(settingsPath)
    const service = new FeeSettingsService({ settingsPath, fetch: okFetch(policy(1, 3)) })

    await expect(service.set('main', 99)).rejects.toThrow(/334 sat\/kB/)
    await expect(readFile(settingsPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a custom rate when policy fetch fails and leaves existing settings unchanged', async () => {
    const settingsPath = await temporarySettingsPath()
    temporaryPaths.push(settingsPath)
    await writeFile(settingsPath, JSON.stringify({ main: 500, test: 600 }))
    const service = new FeeSettingsService({
      settingsPath,
      fetch: async () => { throw new Error('policy unavailable') }
    })

    await expect(service.set('main', 700)).rejects.toThrow('policy unavailable')
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ main: 500, test: 600 })
  })

  it('persists per-chain settings, serializes concurrent writes, and resets one chain only', async () => {
    const settingsPath = await temporarySettingsPath()
    temporaryPaths.push(settingsPath)
    const calls: string[] = []
    const service = new FeeSettingsService({ settingsPath, fetch: okFetch(policy(100, 1_000), calls) })

    const [main, test] = await Promise.all([
      service.set('main', 500),
      service.set('test', 600)
    ])
    expect(main).toMatchObject({ chain: 'main', customRate: 500, effectiveRate: 500, floorRate: 100, restartRequired: true })
    expect(test).toMatchObject({ chain: 'test', customRate: 600, effectiveRate: 600, floorRate: 100, restartRequired: true })
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ main: 500, test: 600 })

    await service.get('main')
    const callCountBeforeReset = calls.length
    const reset = await service.set('main', null)
    expect(reset).toMatchObject({ chain: 'main', customRate: null, effectiveRate: 250, floorRate: null, restartRequired: false })
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ main: null, test: 600 })
    expect((await service.get('test')).customRate).toBe(600)
    expect(calls.length).toBe(callCountBeforeReset + 1)
  })

  it('uses a process snapshot for runtime fallbacks when saving before storage starts', async () => {
    const settingsPath = await temporarySettingsPath()
    temporaryPaths.push(settingsPath)
    const service = new FeeSettingsService({ settingsPath, fetch: okFetch(policy(100, 1_000)) })

    await service.set('main', 500)
    expect(getConfiguredFeeRate('main', 250, settingsPath)).toBe(250)
    expect(getConfiguredFeeRate('test', 100, settingsPath)).toBe(100)
  })

  it('loads a persisted custom rate into the startup snapshot', async () => {
    const settingsPath = await temporarySettingsPath()
    temporaryPaths.push(settingsPath)
    await writeFile(settingsPath, JSON.stringify({ main: 425 }))
    const service = new FeeSettingsService({ settingsPath, fetch: okFetch(policy(100, 1_000)) })

    expect(getConfiguredFeeRate('main', 250, settingsPath)).toBe(425)
    expect((await service.get('main')).restartRequired).toBe(false)
  })

  it('rejects malformed persisted settings', async () => {
    const settingsPath = await temporarySettingsPath()
    temporaryPaths.push(settingsPath)
    await writeFile(settingsPath, JSON.stringify({ main: 0 }))
    expect(() => new FeeSettingsService({ settingsPath })).toThrow(/Malformed fee settings/)
    expect(() => parseFeeSettingsFile({ main: Infinity })).toThrow()
  })
})

describe('fee IPC registration', () => {
  it('keeps chain and rate validation on the main-process side', async () => {
    const settingsPath = await temporarySettingsPath()
    temporaryPaths.push(settingsPath)
    const service = new FeeSettingsService({ settingsPath, fetch: okFetch(policy(100, 1_000)) })
    const handlers = new Map<string, (...args: any[]) => unknown>()
    registerFeeSettingsIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, service)

    await expect(handlers.get('fees:get')!({}, 'invalid')).rejects.toThrow(/Invalid fee settings chain/)
    await expect(handlers.get('fees:set')!({}, 'main', 0)).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/positive integer/)
    })
  })
})
