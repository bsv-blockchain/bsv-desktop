/**
 * Host consent gate between the color permission module and the React prompt
 * (design C10, audit C6, contract §2.5).
 *
 * The module calls `requestTokenAccess(originator, message)` with a JSON
 * consent message. The host keeps one 30-minute inventory **read** grant per
 * originator, set only by approving `color_access`. Spends, signatures,
 * relinquishments and offline receipts prompt every time and never set or
 * consume that grant (0207:8034, "a generic cryptographic or spending grant
 * does not automatically authorize this inventory scope").
 *
 * Fail closed: anything that is not a well-formed known consent message is
 * declined without a prompt, only a literal `true` from the prompt approves,
 * and a prompt that throws is a denial.
 */

import type { PermissionPromptHandler } from '../types'

/** Lifetime of a host read grant (design C10). */
export const READ_GRANT_MS = 1_800_000

/** 0207:8027 */
const READ_REQUIRED = 'Colored Tokens inventory read permission is required'
/** 0207:3186 */
const SPEND_REQUIRED = 'Colored Tokens spending permission is required'
/** Host text for `color_receive_offline` (contract §2.5, D19). */
const RECEIVE_REQUIRED = 'Colored Tokens receive permission is required'

/**
 * Thrown instead of prompting when the caller asked for `seekPermission:false`
 * and no applicable grant exists. Matched by `.name` across bundles (D22); the
 * message is the exact spec text.
 */
export class ColorPermissionRequiredError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'ColorPermissionRequiredError'
  }
}

type ConsentType =
  | 'color_access'
  | 'color_send'
  | 'color_signature'
  | 'color_relinquish'
  | 'color_receive_offline'

const SPEND_TYPES: ReadonlySet<string> = new Set(['color_send', 'color_signature', 'color_relinquish'])

function parseConsent (message: string): { type: ConsentType, seek: boolean } | undefined {
  let value: unknown
  try {
    value = JSON.parse(message)
  } catch {
    return undefined
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { type, seekPermission } = value as { type?: unknown, seekPermission?: unknown }
  if (
    type !== 'color_access' &&
    type !== 'color_send' &&
    type !== 'color_signature' &&
    type !== 'color_relinquish' &&
    type !== 'color_receive_offline'
  ) {
    return undefined
  }
  // Contract §2.5: only an explicit `false` withholds the prompt.
  return { type, seek: seekPermission !== false }
}

export type ColorConsentGate = ((app: string, message: string) => Promise<boolean>) & { clear(): void }

export function createColorConsentGate (o: {
  adminOriginator: string
  prompt: PermissionPromptHandler
  now?: () => number
  enrich?: (message: string) => Promise<string>
}): ColorConsentGate {
  const now = o.now ?? (() => Date.now())
  /** originator -> approval time of its read grant */
  const grants = new Map<string, number>()
  /** originator -> the in-flight `color_access` prompt others join */
  const inFlight = new Map<string, Promise<boolean>>()
  /** bumped by clear(); prompts started before a clear() grant nothing */
  let generation = 0

  const hasLiveGrant = (app: string): boolean => {
    const grantedAt = grants.get(app)
    if (grantedAt === undefined) return false
    const elapsed = now() - grantedAt
    // A clock that moved backwards fails closed instead of extending the grant.
    if (elapsed >= 0 && elapsed <= READ_GRANT_MS) return true
    grants.delete(app)
    return false
  }

  const ask = async (app: string, message: string): Promise<boolean> => {
    let shown = message
    if (o.enrich) {
      try {
        shown = await o.enrich(message)
      } catch {
        shown = message
      }
    }
    try {
      return (await o.prompt(app, shown)) === true
    } catch {
      return false
    }
  }

  const readAccess = (app: string, message: string): Promise<boolean> => {
    const joined = inFlight.get(app)
    if (joined) return joined
    const gen = generation
    // Assigned before the body's first await, so `finally` always sees it.
    let p: Promise<boolean> | undefined
    p = (async () => {
      try {
        const ok = await ask(app, message)
        if (ok && gen === generation) grants.set(app, now())
        return ok
      } finally {
        // Only remove our own entry: after clear() a newer prompt may own the slot.
        if (inFlight.get(app) === p) inFlight.delete(app)
      }
    })()
    inFlight.set(app, p)
    return p
  }

  const gate = async (app: string, message: string): Promise<boolean> => {
    const consent = parseConsent(message)
    if (!consent) return false

    if (consent.type === 'color_access') {
      if (app === o.adminOriginator) return true
      if (hasLiveGrant(app)) return true
      if (!consent.seek) throw new ColorPermissionRequiredError(READ_REQUIRED)
      return await readAccess(app, message)
    }

    if (SPEND_TYPES.has(consent.type)) {
      if (!consent.seek) throw new ColorPermissionRequiredError(SPEND_REQUIRED)
      return await ask(app, message)
    }

    // color_receive_offline: prompt every time, no continuing grant (D19 allows
    // one; the desktop does not keep it, D-DESK-3).
    if (!consent.seek) throw new ColorPermissionRequiredError(RECEIVE_REQUIRED)
    return await ask(app, message)
  }

  return Object.assign(gate, {
    clear (): void {
      generation++
      grants.clear()
      inFlight.clear()
    }
  })
}
