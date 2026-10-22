/**
 * Holder-send linkage grant policy (D20, contract §5 "recipient output").
 *
 * A Mandala holder send computes the recipient output's linkage through the
 * app's wallet, so on the desktop these calls reach `WalletPermissionsManager`
 * from the app's originator:
 * - `revealCounterpartyKeyLinkage({ counterparty: B, verifier: K })`, gated as
 *   protocol `[2, 'counterparty key linkage revelation <B>']` toward K;
 * - two `encrypt` calls under `[2, 'specific linkage revelation 2 p color …']`
 *   toward K, whose name carries a random prefix and suffix per send.
 *
 * With the linkage and encrypt prompts enabled in Settings the manager would
 * prompt on every send (the name is new each time). Approving one
 * `Mandala token sending` prompt therefore grants, for 30 minutes:
 * - family a: every `specific linkage revelation 2 p color …` name from that
 *   originator toward a configured Mandala overlay key;
 * - family b: `counterparty key linkage revelation <B>` toward an overlay key,
 *   for that (originator, B) only.
 *
 * Only requests toward a configured overlay key match (fail closed: none
 * configured, nothing matches). A grant is in memory only, a clock that moved
 * backwards fails closed, and `clear()` (wallet rebuild/close) drops all.
 */

export const LINKAGE_PROTOCOL_PREFIX = 'specific linkage revelation 2 p color '
export const COUNTERPARTY_LINKAGE_PREFIX = 'counterparty key linkage revelation '
export const LINKAGE_GRANT_MS = 1_800_000

/** Contract §0: the longest protocol name a `p color` key may have. */
const MAX_PROTOCOL_NAME = 310
const IDENTITY_KEY = /^0[23][0-9a-f]{64}$/

export type LinkageRequest = {
  originator: string
  protocolID: [number, string]
  counterparty?: string
}

export interface ColorLinkageGrantPolicy {
  matches(r: LinkageRequest): boolean
  live(r: LinkageRequest): boolean
  grant(r: LinkageRequest): void
  clear(): void
}

type Classified =
  | { family: 'a', key: string }
  | { family: 'b', key: string, recipient: string }

export function createColorLinkageGrantPolicy (o: {
  overlayKeys: () => readonly string[]
  now?: () => number
}): ColorLinkageGrantPolicy {
  const now = o.now ?? (() => Date.now())
  /** grant key -> approval time */
  const grants = new Map<string, number>()

  const isOverlayKey = (counterparty: unknown): boolean => {
    if (typeof counterparty !== 'string' || counterparty.length === 0) return false
    const wanted = counterparty.toLowerCase()
    let keys: readonly string[]
    try {
      keys = o.overlayKeys() ?? []
    } catch {
      return false
    }
    return Array.isArray(keys) && keys.some(k => typeof k === 'string' && k.toLowerCase() === wanted)
  }

  const classify = (r: LinkageRequest): Classified | undefined => {
    if (r === null || typeof r !== 'object') return undefined
    const { originator, protocolID, counterparty } = r
    if (typeof originator !== 'string' || !Array.isArray(protocolID)) return undefined
    const [level, name] = protocolID
    if (level !== 2 || typeof name !== 'string') return undefined
    if (!isOverlayKey(counterparty)) return undefined
    if (name.startsWith(LINKAGE_PROTOCOL_PREFIX) && name.length <= MAX_PROTOCOL_NAME) {
      return { family: 'a', key: `a\u0000${originator}` }
    }
    if (name.startsWith(COUNTERPARTY_LINKAGE_PREFIX)) {
      const recipient = name.slice(COUNTERPARTY_LINKAGE_PREFIX.length)
      if (IDENTITY_KEY.test(recipient)) return { family: 'b', key: `b\u0000${originator}\u0000${recipient}`, recipient }
    }
    return undefined
  }

  return {
    matches: r => classify(r) !== undefined,
    live (r) {
      const c = classify(r)
      if (!c) return false
      const grantedAt = grants.get(c.key)
      if (grantedAt === undefined) return false
      const elapsed = now() - grantedAt
      if (elapsed >= 0 && elapsed <= LINKAGE_GRANT_MS) return true
      grants.delete(c.key)
      return false
    },
    grant (r) {
      const c = classify(r)
      if (c) grants.set(c.key, now())
    },
    clear () {
      grants.clear()
    }
  }
}

/** The prompt text for a matching request (ProtocolPermissionHandler shows it as the description). */
export function linkagePromptDescription (r: LinkageRequest): string {
  const name = r.protocolID[1]
  if (name.startsWith(COUNTERPARTY_LINKAGE_PREFIX)) {
    return `Mandala token sending: reveal your link to ${name.slice(COUNTERPARTY_LINKAGE_PREFIX.length)} to the Mandala overlay`
  }
  return 'Mandala token sending'
}
