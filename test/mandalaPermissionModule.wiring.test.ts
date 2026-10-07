import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Beef, Hash, PrivateKey, Transaction, UnlockingScript } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'
import { walletMandalaUnlock } from '@bsv/mandala/unlock'

vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
// The published BTMS UI uses extensionless ESM imports resolved by Vite's
// renderer bundler. Keep that renderer-only component out of the Node test.
vi.mock('@bsv/btms-permission-module-ui', () => ({ BtmsPermissionPrompt: () => null }))

import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'
import { buildPermissionModuleRegistry } from '../src/lib/permissionModules/registry'
import { mandalaPermissionModule } from '../src/lib/permissionModules/mandala'
import { btmsPermissionModule } from '../src/lib/permissionModules/btms'
import { MandalaToken } from '../src/lib/permissionModules/mandala/token'

const ADMIN = 'desktop-admin.example.com'
const APP = 'mandala-test.bsvblockchain.tech'
const ASSET_ID = 'a'.repeat(64) + '_0'
const template = new MandalaToken()
const signingKey = new PrivateKey(7)

beforeEach(() => vi.stubGlobal('window', {}))
afterEach(() => vi.unstubAllGlobals())

function createManager(wallet: WalletInterface, approve = vi.fn(async () => true)) {
  const queue = new PermissionQueueManager()
  queue.adminOriginator = ADMIN
  queue.permissionsConfig = { encryptWalletMetadata: false } as any
  queue.enabledPermissionModules = ['mandala']
  const registry = buildPermissionModuleRegistry([mandalaPermissionModule])
  queue.setPermissionsModuleHelpers(registry.getPermissionModuleById, new Map([['mandala', approve]]))
  return { manager: queue.createPermissionsManager(wallet), queue, approve }
}

/** A complete token balance sent in one transaction, with two inputs. */
function tokenSpend() {
  const sources = [1000, 500].map(amount => {
    const tx = new Transaction()
    tx.addOutput({ satoshis: 1, lockingScript: template.lock(ASSET_ID, amount, new Array(20).fill(7)) })
    return tx
  })
  const tx = new Transaction()
  for (const sourceTransaction of sources) {
    tx.addInput({ sourceTransaction, sourceOutputIndex: 0, sequence: 0xffffffff, unlockingScript: new UnlockingScript() })
  }
  tx.addOutput({ satoshis: 1, lockingScript: template.lock(ASSET_ID, 1500, new Array(20).fill(8)) })
  const beef = new Beef()
  sources.forEach(source => beef.mergeTransaction(source))
  beef.mergeTransaction(tx)
  return {
    tx,
    atomic: beef.toBinaryAtomic(tx.id('hex')),
    outpoints: sources.map(source => `${source.id('hex')}.0`),
  }
}

describe('desktop Mandala permissions factory', () => {
  it.each([false, true])('approves a full-balance send once and authorizes its real Mandala input signatures (self-send: %s)', async selfSend => {
    const spend = tokenSpend()
    const listOutputs = vi.fn(async (args: any, originator: string) => {
      expect(originator).toBe(ADMIN)
      expect(args.basket).toBe('p mandala')
      const index = args.offset ?? 0
      return { outputs: index < 2 ? [{ outpoint: spend.outpoints[index] }] : [], totalOutputs: 2 }
    })
    const createAction = vi.fn(async () => ({ signableTransaction: { tx: spend.atomic, reference: 'token-send' } }))
    const createSignature = vi.fn(async (args: any) => ({ signature: signingKey.sign(args.hashToDirectlySign).toDER() }))
    const getPublicKey = vi.fn(async () => ({ publicKey: signingKey.toPublicKey().toString() }))
    const wallet = { listOutputs, createAction, createSignature, getPublicKey } as unknown as WalletInterface
    const { manager, queue, approve } = createManager(wallet)
    const args = {
      description: 'Send my entire Mandala token balance',
      inputs: spend.outpoints.map(outpoint => ({ outpoint, inputDescription: 'Mandala token input', unlockingScriptLength: 108 })),
      outputs: [{
        satoshis: 1,
        lockingScript: spend.tx.outputs[0].lockingScript.toHex(),
        outputDescription: 'Token recipient',
        ...(selfSend ? { basket: 'p mandala', customInstructions: JSON.stringify({ keyID: 'xfer-1', direction: 'sent' }) } : {}),
      }],
    }
    const response = await manager.createAction(args, APP)
    expect(approve).toHaveBeenCalledTimes(1)
    expect(JSON.parse(approve.mock.calls[0][1])).toMatchObject({ type: 'mandala_spend', sendAmount: 1500, changeAmount: 0 })
    expect(createAction.mock.calls[0][0].labels).toContain('p mandala token-spend')
    expect(args).not.toHaveProperty('labels')
    expect(listOutputs.mock.calls.some(([args]) => args.offset === 1)).toBe(true)

    // Bind the app origin exactly as the HTTP bridge does; Mandala's helper
    // computes its actual transaction preimages and asks the real manager.
    const appWallet = {
      createSignature: (args: any) => manager.createSignature(args, APP),
      getPublicKey: (args: any) => manager.getPublicKey(args, APP),
    }
    const toSign = Transaction.fromAtomicBEEF(response.signableTransaction!.tx)
    for (let index = 0; index < toSign.inputs.length; index++) {
      await walletMandalaUnlock(appWallet as never, 'token-key', 'self').sign(toSign, index)
      expect(createSignature.mock.calls[index][0].hashToDirectlySign).toEqual(Hash.hash256(toSign.preimage(index)))
    }
    expect(createSignature).toHaveBeenCalledTimes(2)
    expect(approve).toHaveBeenCalledTimes(1)
    expect(queue.getSnapshot().protocolRequests).toEqual([])
    expect(queue.getSnapshot().spendingRequests).toEqual([])
  })

  it('uses the factory admin originator for complete listings and identifying relinquished outputs', async () => {
    const target = 'c'.repeat(64) + '.0'
    const earlier = 'b'.repeat(64) + '.0'
    const script = template.lock(ASSET_ID, 42, new Array(20).fill(7)).toHex()
    const listOutputs = vi.fn(async (args: any, originator: string) => {
      expect(originator).toBe(ADMIN)
      return {
        outputs: (args.offset ?? 0) === 0 ? [{ outpoint: earlier, lockingScript: script }] : [{ outpoint: target, lockingScript: script }],
        totalOutputs: 2,
      }
    })
    const relinquishOutput = vi.fn(async () => ({ relinquished: true }))
    const { manager, approve } = createManager({ listOutputs, relinquishOutput } as unknown as WalletInterface)
    await manager.relinquishOutput({ basket: 'p mandala', output: target }, APP)
    expect(approve).toHaveBeenCalledTimes(1)
    expect(JSON.parse(approve.mock.calls[0][1])).toMatchObject({ type: 'mandala_access', amount: 42, assetId: ASSET_ID, outpoint: target })
    expect(listOutputs.mock.calls.map(([args]) => args.offset)).toEqual([0, 1])
    expect(listOutputs.mock.calls.every(([args]) => args.include === 'locking scripts' && args.includeCustomInstructions === false)).toBe(true)
    expect(relinquishOutput).toHaveBeenCalledWith({ basket: 'p mandala', output: target }, APP)
  })

  it('uses prompt handlers registered after wallet construction and fails closed after they unmount', async () => {
    const queue = new PermissionQueueManager()
    queue.adminOriginator = ADMIN
    queue.permissionsConfig = { encryptWalletMetadata: false } as any
    queue.enabledPermissionModules = ['mandala']
    const registry = buildPermissionModuleRegistry([mandalaPermissionModule])
    const handlers = new Map()
    queue.setPermissionsModuleHelpers(registry.getPermissionModuleById, handlers)
    const customInstructions = JSON.stringify({ keyID: 'token-key', counterparty: 'self' })
    const output = {
      outpoint: 'c'.repeat(64) + '.0',
      satoshis: 1,
      lockingScript: template.lock(ASSET_ID, 42, new Array(20).fill(7)).toHex(),
    }
    // A real wallet only returns derivation details if the app asks for them.
    const listOutputs = vi.fn(async (args: any) => ({
      totalOutputs: 1,
      outputs: [{ ...output, ...(args.includeCustomInstructions ? { customInstructions } : {}) }],
    }))
    const manager = queue.createPermissionsManager({ listOutputs } as unknown as WalletInterface)
    const approve = vi.fn(async () => true)
    handlers.set('mandala', approve)
    const args = { basket: 'p mandala', includeCustomInstructions: true, include: 'locking scripts' as const, limit: 50 }
    const result = await manager.listOutputs(args, APP)
    expect(result).toEqual({ totalOutputs: 1, outputs: [{ ...output, customInstructions }] })
    expect(result.outputs[0].customInstructions).toBe(customInstructions)
    expect(approve).toHaveBeenCalledTimes(1)
    expect(listOutputs).toHaveBeenCalledWith(args, APP)
    expect(listOutputs.mock.calls[0][0]).toBe(args)

    handlers.delete('mandala')
    await expect(manager.listOutputs({ basket: 'p mandala' }, 'another-app.example.com')).rejects.toThrow('User denied permission to access Mandala tokens')
    expect(listOutputs).toHaveBeenCalledTimes(1)
  })

  it('fails closed without a registered desktop prompt', async () => {
    const queue = new PermissionQueueManager()
    queue.adminOriginator = ADMIN
    queue.permissionsConfig = { encryptWalletMetadata: false } as any
    queue.enabledPermissionModules = ['mandala']
    const registry = buildPermissionModuleRegistry([mandalaPermissionModule])
    queue.setPermissionsModuleHelpers(registry.getPermissionModuleById, new Map())
    const listOutputs = vi.fn(async () => ({ outputs: [], totalOutputs: 0 }))
    const manager = queue.createPermissionsManager({ listOutputs } as unknown as WalletInterface)
    await expect(manager.listOutputs({ basket: 'p mandala', includeCustomInstructions: true }, APP)).rejects.toThrow('User denied permission to access Mandala tokens')
    expect(listOutputs).not.toHaveBeenCalled()
  })
})


describe('desktop permission module preferences', () => {
  const registry = buildPermissionModuleRegistry([btmsPermissionModule, mandalaPermissionModule])

  it('ships BTMS and Mandala enabled with their prompt components', () => {
    expect(registry.getDefaultEnabledPermissionModules()).toEqual(['btms', 'mandala'])
    expect(registry.restoreEnabledPermissionModules()).toEqual(['btms', 'mandala'])
    expect(registry.getPermissionModuleById('mandala')?.Prompt).toBeDefined()
  })

  it('adds Mandala when restoring preferences created before it shipped', () => {
    expect(registry.restoreEnabledPermissionModules(['btms'])).toEqual(['btms', 'mandala'])
    expect(registry.restoreEnabledPermissionModules(['btms'], ['btms'])).toEqual(['btms', 'mandala'])
  })

  it('preserves an earlier explicit BTMS disable while enabling the new default', () => {
    expect(registry.restoreEnabledPermissionModules([])).toEqual(['mandala'])
  })

  it('preserves an explicit Mandala disable after the user has seen both modules', () => {
    expect(registry.restoreEnabledPermissionModules(['btms'], ['btms', 'mandala'])).toEqual(['btms'])
    expect(registry.restoreEnabledPermissionModules([], ['btms', 'mandala'])).toEqual([])
    expect(registry.normalizeEnabledPermissionModules(['btms'])).toEqual(['btms'])
  })

  it('drops unknown saved IDs and keeps known enabled modules only once', () => {
    expect(registry.restoreEnabledPermissionModules(['btms', 'unknown', 'btms'], ['btms'])).toEqual(['btms', 'mandala'])
  })
})
