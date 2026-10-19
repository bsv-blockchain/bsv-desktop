/**
 * Display names for identity keys, from the identity overlay (IdentityClient), cached for the
 * session. Best effort: an unknown key, a failed lookup or a slow one gives '' and the caller
 * shows the short key instead. Failures are not cached, so a later lookup tries again.
 */
import { IdentityClient } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'

const names = new Map<string, Promise<string>>()

/** A key short enough for a toast or a list line. */
export const shortKey = (key: string) => key.length > 16 ? `${key.slice(0, 10)}…${key.slice(-4)}` : key

export function identityName(wallet: WalletInterface | undefined, originator: string, identityKey: string, timeoutMs = 2500): Promise<string> {
  if (!wallet || !identityKey) return Promise.resolve('')
  const cached = names.get(identityKey)
  if (cached) return cached
  const forget = () => { if (names.get(identityKey) === lookup) names.delete(identityKey) }
  const lookup: Promise<string> = new Promise<string>(resolve => {
    const timer = setTimeout(() => { forget(); resolve('') }, timeoutMs)
    new IdentityClient(wallet, undefined, originator).resolveByIdentityKey({ identityKey })
      .then(results => resolve(results?.[0]?.name || ''))
      .catch(() => { forget(); resolve('') })
      .finally(() => clearTimeout(timer))
  })
  names.set(identityKey, lookup)
  return lookup
}

/** Name or short key. */
export async function identityLabel(wallet: WalletInterface | undefined, originator: string, identityKey: string): Promise<string> {
  return (await identityName(wallet, originator, identityKey)) || shortKey(identityKey)
}
