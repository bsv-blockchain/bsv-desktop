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
}
