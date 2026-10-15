/**
 * The originator form WalletPermissionsManager scopes permissions by: the
 * lower-case hostname, without scheme or port (IPv6 in brackets). Mirrors the
 * toolbox's normalizeOriginator exactly.
 */
export function normalizeOriginator(originator?: string): string | undefined {
  const trimmed = originator?.trim()
  if (!trimmed) return originator
  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
    const hostname = new URL(hasScheme ? trimmed : `https://${trimmed}`).hostname.toLowerCase()
    if (!hostname) return trimmed.toLowerCase()
    // Same bracket rule as the toolbox, so the strings compare equal.
    return hostname.includes(':') ? `[${hostname}]` : hostname
  } catch {
    return trimmed.toLowerCase()
  }
}
