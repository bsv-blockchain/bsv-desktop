import type { ModuleKeyDeriver } from './types'

// Captured at load, so patching these later does not loosen the checks below.
// Hardening only; see the trust model on revocableKeyDeriver.
const isArray = Array.isArray
const startsWith = String.prototype.startsWith
const apply = Reflect.apply
const freeze = Object.freeze

/**
 * A derivePrivateKey-only view of `source` for one permission module.
 *
 * Trust model: permission modules are host-bundled, trusted code that runs in
 * the wallet's own JavaScript realm. This view limits what a well-behaved
 * module can ask for, is revoked when the wallet closes, and guards against
 * mistakes. It is not a sandbox: a module that tampers with shared prototypes
 * is outside what it can stop. A permission module continues to receive the
 * wallet object itself, as before this view existed: the view is least
 * authority for this one new argument and is not a containment boundary.
 *
 * A request is forwarded only when all of these hold; anything else throws
 * before `source` is called:
 * - `protocolID` is an array of length 2, `[level, name]`, each element read
 *   once;
 * - `level` is the number 0, 1 or 2;
 * - `name` is a string starting with `protocolPrefix`;
 * - `keyID` is a string;
 * - `counterparty` is the string `'self'`. Other counterparties are not
 *   supported in this version.
 *
 * `source` receives a fresh `[level, name]` array built from the values that
 * were checked, never the caller's object. The view and its function are
 * frozen. `source` is held only in the closure and dropped on revocation,
 * after which every call throws; keys derived before then stay with the
 * module.
 */
export function revocableKeyDeriver(
  source: ModuleKeyDeriver,
  protocolPrefix: string
): { deriver: ModuleKeyDeriver, revoke: () => void } {
  if (typeof protocolPrefix !== 'string' || protocolPrefix === '') {
    throw new TypeError('A module key deriver needs a protocol prefix to scope it')
  }
  const refuse = (): never => {
    throw new Error(`This module may only derive keys under "${protocolPrefix}" protocols`)
  }
  let current: ModuleKeyDeriver | null = source
  const derivePrivateKey: ModuleKeyDeriver['derivePrivateKey'] = (protocolID, keyID, counterparty) => {
    if (current === null) throw new Error('The wallet this key deriver belongs to is closed')
    if (!isArray(protocolID)) return refuse()
    const length: unknown = protocolID.length
    if (length !== 2) return refuse()
    const level: unknown = protocolID[0]
    const name: unknown = protocolID[1]
    if (level !== 0 && level !== 1 && level !== 2) return refuse()
    if (typeof name !== 'string' || !apply(startsWith, name, [protocolPrefix])) return refuse()
    if (typeof keyID !== 'string') throw new TypeError('keyID must be a string')
    if (counterparty !== 'self') {
      throw new TypeError("counterparty must be 'self'; other counterparties are not supported in this version")
    }
    return current.derivePrivateKey([level, name], keyID, 'self')
  }
  const deriver: ModuleKeyDeriver = freeze({ derivePrivateKey: freeze(derivePrivateKey) })
  return { deriver, revoke: () => { current = null } }
}
