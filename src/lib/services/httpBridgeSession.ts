/**
 * Tracks in-flight HTTP bridge requests so permission UI can be cancelled when
 * the HTTP client disconnects while a wallet call is still waiting on the user.
 *
 * Correlation is by originator (host). Concurrent requests from different apps
 * do not cancel each other's prompts. Same-origin concurrent requests share
 * association (rare; both may be denied if one disconnects).
 */

export type HttpBridgeSession = {
  requestId: number
  origin: string
  cancelled: boolean
  permissionIds: Set<string>
}

const sessions = new Map<number, HttpBridgeSession>()
let bridgePaused = false
let userOperations = 0
/** The part of `userOperations` that is background work (see beginBackgroundWalletOperation). */
let backgroundOperations = 0
let changeRequests = 0

/** Why Lock, a switch or removal must wait while only background work holds the wallet. */
export const BACKGROUND_RETRY_BUSY = 'Your wallet is retrying received direct payments in the background. That stops within 15 seconds; try again then.'

/** A network change cannot straddle an app request or a permission decision. */
export function activeHttpBridgeRequests(): number { return sessions.size }
export function setHttpBridgePaused(paused: boolean): void { bridgePaused = paused }
export function isHttpBridgePaused(): boolean { return bridgePaused }
export function activeUserWalletOperations(): number { return userOperations }
/** Hold a network switch until a first-party payment has finished. */
export function beginUserWalletOperation(): () => void {
  if (bridgePaused) throw new Error('The wallet network is changing. Try again shortly.')
  userOperations++
  let released = false
  return () => { if (!released) { released = true; userOperations-- } }
}

/**
 * Wallet work the app starts by itself: retrying kept direct payments (DirectPayManager). It
 * holds a network switch off like a user operation, and counts as one, but gives way to Lock, a
 * switch or removal (see {@link walletChangeBlocker}).
 */
export function beginBackgroundWalletOperation(): () => void {
  const release = beginUserWalletOperation()
  backgroundOperations++
  let released = false
  return () => { if (!released) { released = true; backgroundOperations--; release() } }
}

/** Counts every Lock, profile or network switch, and removal asked for; background work stops when it changes. */
export function walletChangeRequests(): number { return changeRequests }

/**
 * Lock, a profile or network switch, or wallet removal was asked for. Background work is asked to
 * stop at its next step (it then waits its usual interval before it starts again), and this
 * returns why the change must wait, or '' when nothing holds the wallet:
 * - `foreground` while an app request, a user's payment, a paused bridge or (`pending`) a
 *   permission decision or a switch is in progress;
 * - {@link BACKGROUND_RETRY_BUSY} when background work alone holds the wallet.
 */
export function walletChangeBlocker(foreground: string, pending = false): string {
  changeRequests++
  if (pending || bridgePaused || sessions.size > 0 || userOperations > backgroundOperations) return foreground
  return backgroundOperations > 0 ? BACKGROUND_RETRY_BUSY : ''
}

export function normalizeBridgeOrigin(originator: string): string {
  return String(originator || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
    .toLowerCase()
}

export function beginHttpBridgeSession(requestId: number, origin: string): void {
  sessions.set(requestId, {
    requestId,
    origin: normalizeBridgeOrigin(origin),
    cancelled: false,
    permissionIds: new Set(),
  })
}

export function endHttpBridgeSession(requestId: number): void {
  sessions.delete(requestId)
}

export function getHttpBridgeSession(requestId: number): HttpBridgeSession | undefined {
  return sessions.get(requestId)
}

export function markHttpBridgeSessionCancelled(requestId: number): HttpBridgeSession | undefined {
  const session = sessions.get(requestId)
  if (!session) return undefined
  session.cancelled = true
  return session
}

/**
 * Associate a permission prompt with live HTTP sessions for the same originator.
 * Returns 'auto-deny' when every matching in-flight session was already cancelled
 * (client gone; do not show UI). Returns 'track' when the prompt should be shown.
 */
export function trackPermissionForHttpBridge(
  requestID: string,
  originator: string | undefined
): 'track' | 'auto-deny' {
  if (!originator) return 'track'

  const norm = normalizeBridgeOrigin(originator)
  const matching = [...sessions.values()].filter((s) => s.origin === norm)

  // No HTTP bridge session (e.g. in-app admin call) — show UI as usual.
  if (matching.length === 0) return 'track'

  const live = matching.filter((s) => !s.cancelled)
  if (live.length === 0) return 'auto-deny'

  for (const session of live) {
    session.permissionIds.add(requestID)
  }
  return 'track'
}

/** Test-only: clear module state */
export function _test_resetHttpBridgeSessions(): void {
  sessions.clear()
  bridgePaused = false
  userOperations = 0
  backgroundOperations = 0
}
