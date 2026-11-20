/**
 * The key deriver a permission module may receive: a derivePrivateKey-only
 * view for the module's own `p <id> ` protocol namespace and the counterparty
 * `'self'`, given only to modules that declare `needsKeyDeriver`, one per
 * module, and revoked when the wallet is rebuilt or closed or the build fails.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))
vi.mock('@bsv/btms-permission-module-ui', () => ({ BtmsPermissionPrompt: () => null }))

import { CachedKeyDeriver, PrivateKey } from '@bsv/sdk'
import { revocableKeyDeriver } from '../src/lib/permissionModules/keyDeriver'
import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'
import type { ModuleKeyDeriver, PermissionModuleDefinition } from '../src/lib/permissionModules/types'

const wallet = {} as any

describe('revocableKeyDeriver', () => {
  test('the view derives through the source and exposes nothing else', () => {
    const source = { derivePrivateKey: vi.fn(() => 'k' as any), rootKey: 'secret', derivePublicKey: vi.fn() }
    const { deriver } = revocableKeyDeriver(source as any, 'p sigma ')
    expect(deriver.derivePrivateKey([1, 'p sigma test'], 'id', 'self')).toBe('k')
    expect(source.derivePrivateKey).toHaveBeenCalledWith([1, 'p sigma test'], 'id', 'self')
    expect(Object.keys(deriver)).toEqual(['derivePrivateKey'])
    expect((deriver as any).rootKey).toBeUndefined()
  })

  test('a revoked view refuses', () => {
    const { deriver, revoke } = revocableKeyDeriver({ derivePrivateKey: () => 'k' as any }, 'p sigma ')
    revoke()
    expect(() => deriver.derivePrivateKey([1, 'p sigma test'], 'id', 'self')).toThrow(/closed/)
  })

  test('the view cannot be altered to reach past revocation', () => {
    const { deriver, revoke } = revocableKeyDeriver({ derivePrivateKey: () => 'k' as any }, 'p sigma ')
    expect(Object.isFrozen(deriver)).toBe(true)
    revoke()
    expect(() => { (deriver as any).derivePrivateKey = () => 'k' }).toThrow()
    expect(() => deriver.derivePrivateKey([1, 'p sigma test'], 'id', 'self')).toThrow(/closed/)
  })

  test('nothing can be attached to the view or its function', () => {
    const { deriver } = revocableKeyDeriver({ derivePrivateKey: () => 'k' as any }, 'p sigma ')
    expect(Object.isFrozen(deriver.derivePrivateKey)).toBe(true)
    expect(() => { (deriver.derivePrivateKey as any).extra = 1 }).toThrow()
    expect(() => { (deriver as any).extra = 1 }).toThrow()
  })

  test('an in-namespace derivation is forwarded unchanged', () => {
    const source = { derivePrivateKey: vi.fn(() => 'k' as any) }
    const { deriver } = revocableKeyDeriver(source, 'p sigma ')
    expect(deriver.derivePrivateKey([2, 'p sigma level two'], 'key 7', 'self')).toBe('k')
    expect(source.derivePrivateKey).toHaveBeenCalledWith([2, 'p sigma level two'], 'key 7', 'self')
  })

  test.each([
    ['another scheme', [1, 'p other thing']],
    ['an ordinary protocol', [2, '3241645161d8']],
    ['a longer id sharing the prefix', [1, 'p sigmaX y']],
    ['the bare prefix without its space', [1, 'p sigma']],
    ['a non-array', 'p sigma test'],
    ['a one-element array', ['p sigma test']],
    ['a non-string name', [1, 42]],
  ])('refuses %s', (_, protocolID) => {
    const source = { derivePrivateKey: vi.fn(() => 'k' as any) }
    const { deriver } = revocableKeyDeriver(source, 'p sigma ')
    expect(() => deriver.derivePrivateKey(protocolID as any, 'id', 'self')).toThrow(/may only derive keys under "p sigma "/)
    expect(source.derivePrivateKey).not.toHaveBeenCalled()
  })

  test('a revoked view still refuses an in-namespace request as closed', () => {
    const { deriver, revoke } = revocableKeyDeriver({ derivePrivateKey: () => 'k' as any }, 'p sigma ')
    revoke()
    expect(() => deriver.derivePrivateKey([1, 'p sigma test'], 'id', 'self')).toThrow(/closed/)
  })

  test('an unscoped view cannot be asked for', () => {
    expect(() => revocableKeyDeriver({ derivePrivateKey: () => 'k' as any }, '')).toThrow(TypeError)
  })

  /**
   * The source may be called at most once, and only with a fresh plain array
   * whose name is the in-namespace string that was checked.
   */
  const expectOnlyCheckedName = (source: { derivePrivateKey: ReturnType<typeof vi.fn> }, callerObject: unknown) => {
    expect(source.derivePrivateKey.mock.calls.length).toBeLessThanOrEqual(1)
    for (const [arg] of source.derivePrivateKey.mock.calls) {
      expect(arg).not.toBe(callerObject)
      expect(Array.isArray(arg)).toBe(true)
      expect(Object.getPrototypeOf(arg)).toBe(Array.prototype)
      for (const key of Reflect.ownKeys(arg)) {
        expect('value' in Object.getOwnPropertyDescriptor(arg, key)!).toBe(true)
      }
      expect(arg[1]).toBe('p sigma test')
    }
  }

  test('a name that changes between reads cannot reach another namespace (getter array)', () => {
    const source = { derivePrivateKey: vi.fn((..._: unknown[]) => 'k' as any) }
    const { deriver } = revocableKeyDeriver(source as any, 'p sigma ')
    let reads = 0
    const protocolID: any = [2, undefined]
    Object.defineProperty(protocolID, 1, { get: () => (reads++ < 2 ? 'p sigma test' : '3241645161d8') })
    try { deriver.derivePrivateKey(protocolID, '1', 'self') } catch (e) { expect(String(e)).toMatch(/may only derive keys under/) }
    expectOnlyCheckedName(source, protocolID)
  })

  test('a name that changes between reads cannot reach another namespace (Proxy)', () => {
    const source = { derivePrivateKey: vi.fn((..._: unknown[]) => 'k' as any) }
    const { deriver } = revocableKeyDeriver(source as any, 'p sigma ')
    let reads = 0
    const protocolID: any = new Proxy([2, 'p sigma test'], {
      get: (target, key, receiver) => (key === '1' ? (reads++ < 2 ? 'p sigma test' : '3241645161d8') : Reflect.get(target, key, receiver))
    })
    try { deriver.derivePrivateKey(protocolID, '1', 'self') } catch (e) { expect(String(e)).toMatch(/may only derive keys under/) }
    expectOnlyCheckedName(source, protocolID)
  })

  test.each([
    ['a string level', '2-3241645161d8'],
    ['a fractional level', 2.5],
    ['a level out of range', 3],
    ['an object level with valueOf', { valueOf: () => 2 }],
  ])('refuses %s', (_, level) => {
    const source = { derivePrivateKey: vi.fn(() => 'k' as any) }
    const { deriver } = revocableKeyDeriver(source, 'p sigma ')
    expect(() => deriver.derivePrivateKey([level, 'p sigma test'] as any, 'id', 'self')).toThrow(/may only derive keys under/)
    expect(source.derivePrivateKey).not.toHaveBeenCalled()
  })

  test('refuses a three-element array', () => {
    const source = { derivePrivateKey: vi.fn(() => 'k' as any) }
    const { deriver } = revocableKeyDeriver(source, 'p sigma ')
    expect(() => deriver.derivePrivateKey([1, 'p sigma test', 'x'] as any, 'id', 'self')).toThrow(/may only derive keys under/)
    expect(source.derivePrivateKey).not.toHaveBeenCalled()
  })

  test.each([
    ['a non-string keyID', [{ toString: () => 'id' }, 'self']],
    ['a number counterparty', ['id', 42]],
    ['a null counterparty', ['id', null]],
  ])('refuses %s', (_, [keyID, counterparty]) => {
    const source = { derivePrivateKey: vi.fn(() => 'k' as any) }
    const { deriver } = revocableKeyDeriver(source, 'p sigma ')
    expect(() => deriver.derivePrivateKey([1, 'p sigma test'], keyID as any, counterparty as any)).toThrow()
    expect(source.derivePrivateKey).not.toHaveBeenCalled()
  })

  /** A real deriver on a throwaway key, its derivePrivateKey spied, and a view of it. */
  const realDeriver = () => {
    const root = PrivateKey.fromRandom()
    const real = new CachedKeyDeriver(root)
    const derive = vi.spyOn(real, 'derivePrivateKey')
    return { root, derive, deriver: revocableKeyDeriver(real, 'p sigma ').deriver }
  }

  test('a counterparty object is refused without being inspected', () => {
    const { derive, deriver } = realDeriver()
    const touched: string[] = []
    const record = (trap: string) => (...args: unknown[]) => {
      touched.push(trap)
      return (Reflect as any)[trap](...args)
    }
    const counterparty = new Proxy({}, {
      get: record('get'),
      has: record('has'),
      ownKeys: record('ownKeys'),
      getOwnPropertyDescriptor: record('getOwnPropertyDescriptor'),
      getPrototypeOf: record('getPrototypeOf'),
      defineProperty: record('defineProperty'),
      set: record('set'),
      deleteProperty: record('deleteProperty'),
      isExtensible: record('isExtensible'),
      preventExtensions: record('preventExtensions'),
      setPrototypeOf: record('setPrototypeOf')
    })
    expect(() => deriver.derivePrivateKey([1, 'p sigma test'], 'id', counterparty as any))
      .toThrow(new TypeError("counterparty must be 'self'; other counterparties are not supported in this version"))
    expect(derive).not.toHaveBeenCalled()
    expect(touched).toEqual([])
  })

  test('a real PublicKey counterparty is refused', () => {
    const { derive, deriver } = realDeriver()
    const key = PrivateKey.fromRandom().toPublicKey()
    expect(() => deriver.derivePrivateKey([1, 'p sigma test'], 'id', key)).toThrow(TypeError)
    expect(derive).not.toHaveBeenCalled()
  })

  const compressedHex = PrivateKey.fromRandom().toPublicKey().toString()

  test('the counterparty "anyone" is refused before a real deriver is called', () => {
    const { derive, deriver } = realDeriver()
    expect(() => deriver.derivePrivateKey([1, 'p sigma test'], 'id', 'anyone')).toThrow(TypeError)
    expect(derive).not.toHaveBeenCalled()
  })

  test('a compressed public key in hex is refused as counterparty before a real deriver is called', () => {
    expect(compressedHex).toMatch(/^0[23][0-9a-f]{64}$/)
    const { derive, deriver } = realDeriver()
    expect(() => deriver.derivePrivateKey([1, 'p sigma test'], 'id', compressedHex)).toThrow(TypeError)
    expect(derive).not.toHaveBeenCalled()
  })

  test('the counterparty "self" is forwarded and returns the real deriver\'s key for "self"', () => {
    const { root, derive, deriver } = realDeriver()
    const expected = new CachedKeyDeriver(root).derivePrivateKey([1, 'p sigma test'], 'id', 'self')
    const key = deriver.derivePrivateKey([1, 'p sigma test'], 'id', 'self')
    expect(key).toBeInstanceOf(PrivateKey)
    expect(key.toHex()).toBe(expected.toHex())
    expect(derive).toHaveBeenCalledTimes(1)
    expect(derive).toHaveBeenCalledWith([1, 'p sigma test'], 'id', 'self')
  })

  test.each([
    ['"anyone"', 'anyone'],
    ['a lowercase compressed key in hex', compressedHex],
    ['an uppercase hex key', compressedHex.toUpperCase()],
    ['a 64-hex string', compressedHex.slice(2)],
    ['an uncompressed key', PrivateKey.fromRandom().toPublicKey().encode(false, 'hex')],
    ['an empty string', ''],
    ['a String object', new String('self')],
    ['an object whose toString returns "self"', { toString: () => 'self' }],
    ['an array holding "self"', ['self']],
    ['undefined', undefined],
    ['"Self"', 'Self'],
    ['"self" with a newline', 'self\n'],
  ])('refuses %s as counterparty', (_, counterparty) => {
    const source = { derivePrivateKey: vi.fn(() => 'k' as any) }
    const { deriver } = revocableKeyDeriver(source, 'p sigma ')
    expect(() => deriver.derivePrivateKey([1, 'p sigma test'], 'id', counterparty as any)).toThrow(TypeError)
    expect(source.derivePrivateKey).not.toHaveBeenCalled()
  })

  test('a missing counterparty is refused', () => {
    const source = { derivePrivateKey: vi.fn(() => 'k' as any) }
    const { deriver } = revocableKeyDeriver(source, 'p sigma ')
    expect(() => (deriver.derivePrivateKey as any)([1, 'p sigma test'], 'id')).toThrow(TypeError)
    expect(source.derivePrivateKey).not.toHaveBeenCalled()
  })

  test('patching String.prototype.startsWith later does not loosen the check', () => {
    const source = { derivePrivateKey: vi.fn(() => 'k' as any) }
    const { deriver } = revocableKeyDeriver(source, 'p sigma ')
    const original = String.prototype.startsWith
    try {
      String.prototype.startsWith = () => true
      expect(() => deriver.derivePrivateKey([2, '3241645161d8'], '1', 'self')).toThrow(/may only derive keys under/)
    } finally {
      String.prototype.startsWith = original
    }
    expect(source.derivePrivateKey).not.toHaveBeenCalled()
  })

  test('patching Array.isArray later does not loosen the check', () => {
    const source = { derivePrivateKey: vi.fn(() => 'k' as any) }
    const { deriver } = revocableKeyDeriver(source, 'p sigma ')
    const original = Array.isArray
    try {
      Array.isArray = ((_: unknown): _ is any[] => true) as typeof Array.isArray
      expect(() => deriver.derivePrivateKey({ 0: 1, 1: 'p sigma test', length: 2 } as any, '1', 'self')).toThrow(/may only derive keys under/)
    } finally {
      Array.isArray = original
    }
    expect(source.derivePrivateKey).not.toHaveBeenCalled()
  })
})

describe('PermissionQueueManager key deriver', () => {
  beforeEach(() => vi.stubGlobal('window', {}))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  const setup = (defs: PermissionModuleDefinition[]) => {
    const queue = new PermissionQueueManager()
    queue.adminOriginator = 'admin.example.com'
    queue.permissionsConfig = {} as any
    queue.enabledPermissionModules = defs.map(d => d.id)
    const byId = new Map(defs.map(d => [d.id, d]))
    queue.setPermissionsModuleHelpers(id => byId.get(id), new Map())
    return queue
  }

  let seen: Record<string, ModuleKeyDeriver | undefined>
  let source: ModuleKeyDeriver
  beforeEach(() => {
    seen = {}
    source = { derivePrivateKey: vi.fn(() => 'k' as any) }
  })
  const def = (id: string, needsKeyDeriver?: boolean): PermissionModuleDefinition =>
    ({ id, label: id, needsKeyDeriver, createModule: a => { seen[id] = a.keyDeriver; return {} } })
  /** Derives in module `id`'s own namespace with the view module `id` received. */
  const derive = (id: string) => seen[id]!.derivePrivateKey([1, `p ${id} test`], 'id', 'self')

  test('only a module that declares needsKeyDeriver receives one', () => {
    setup([def('plain'), def('wants', true)]).createPermissionsManager(wallet, undefined, source)
    expect('plain' in seen).toBe(true)
    expect(seen.plain).toBeUndefined()
    expect(typeof (seen.wants as any).derivePrivateKey).toBe('function')
    expect(seen.wants).not.toBe(source)
    expect(derive('wants')).toBe('k')
  })

  test('a module derives only under its own p <id> namespace', () => {
    setup([def('wants', true)]).createPermissionsManager(wallet, undefined, source)
    expect(seen.wants!.derivePrivateKey([1, 'p wants test'], 'id', 'self')).toBe('k')
    expect(() => seen.wants!.derivePrivateKey([1, 'p other test'], 'id', 'self')).toThrow(/may only derive keys under "p wants "/)
    expect(source.derivePrivateKey).toHaveBeenCalledTimes(1)
  })

  test.each(['Wants', 'wa nts'])('a module with id %j that could collide after normalisation gets no deriver', id => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => setup([def(id, true)]).createPermissionsManager(wallet, undefined, source)).not.toThrow()
    expect(id in seen).toBe(true)
    expect(seen[id]).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('each module that asks gets its own view', () => {
    setup([def('a', true), def('b', true)]).createPermissionsManager(wallet, undefined, source)
    expect(seen.a).toBeDefined()
    expect(seen.b).toBeDefined()
    expect(seen.a).not.toBe(seen.b)
  })

  test('a module that asks gets nothing when the build has no deriver', () => {
    setup([def('wants', true)]).createPermissionsManager(wallet)
    expect('wants' in seen).toBe(true)
    expect(seen.wants).toBeUndefined()
  })

  test('a rebuild and a close both revoke the previous build\'s view', () => {
    const queue = setup([def('wants', true)])
    queue.setPermissionsManager(queue.createPermissionsManager(wallet, undefined, source))
    const first = seen.wants!
    queue.setPermissionsManager(queue.createPermissionsManager(wallet, undefined, source))
    const second = seen.wants!
    const inNamespace = (d: ModuleKeyDeriver) => d.derivePrivateKey([1, 'p wants test'], 'id', 'self')
    expect(() => inNamespace(first)).toThrow(/closed/)
    expect(inNamespace(second)).toBe('k')
    queue.disposePermissionModules()
    expect(() => inNamespace(second)).toThrow(/closed/)
  })

  test('closing the wallet revokes the view', () => {
    const queue = setup([def('wants', true)])
    queue.setPermissionsManager(queue.createPermissionsManager(wallet, undefined, source))
    queue.setPermissionsManager(null)
    expect(() => derive('wants')).toThrow(/closed/)
  })

  test('the view is revoked even when the module\'s dispose throws', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queue = setup([{ ...def('wants', true), dispose: () => { throw new Error('boom') } }])
    queue.createPermissionsManager(wallet, undefined, source)
    queue.disposePermissionModules()
    expect(() => derive('wants')).toThrow(/closed/)
    expect(quiet).toHaveBeenCalled()
  })

  test('a failed build leaves no working view, not even with the module that threw', () => {
    const throwing: PermissionModuleDefinition = {
      id: 'throws', label: 'throws', needsKeyDeriver: true,
      createModule: a => { seen.throws = a.keyDeriver; throw new Error('cannot start') }
    }
    const queue = setup([def('wants', true), throwing])
    expect(() => queue.createPermissionsManager(wallet, undefined, source)).toThrow('cannot start')
    expect(() => derive('wants')).toThrow(/closed/)
    expect(() => derive('throws')).toThrow(/closed/)
  })
})
