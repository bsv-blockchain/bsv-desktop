/**
 * Display names for identity keys, from the identity overlay (IdentityClient), cached for the
 * session. Best effort: an unknown key, a failed lookup or a slow one gives '' and the caller
 * shows the short key instead. Failures are not cached, so a later lookup tries again.
 */
import { IdentityClient } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'

/** Per wallet, since each wallet resolves on its own network (review minor 10). */
const byWallet = new WeakMap<object, Map<string, Promise<string>>>()

/** A key short enough for a toast or a list line. */
export const shortKey = (key: string) => key.length > 16 ? `${key.slice(0, 10)}…${key.slice(-4)}` : key

/**
 * The name for `identityKey`, or '' when there is none or it takes longer than `timeoutMs`. The
 * lookup itself keeps running and is cached, so a slow name is there for the next caller.
 */
export function identityName(wallet: WalletInterface | undefined, originator: string, identityKey: string, timeoutMs = 2500): Promise<string> {
  if (!wallet || !identityKey) return Promise.resolve('')
  let names = byWallet.get(wallet)
  if (!names) { names = new Map(); byWallet.set(wallet, names) }
  const cache = names
  let lookup = names.get(identityKey)
  if (!lookup) {
    const started: Promise<string> = new IdentityClient(wallet, undefined, originator).resolveByIdentityKey({ identityKey })
      .then(results => results?.[0]?.name || '')
      .catch(() => { if (cache.get(identityKey) === started) cache.delete(identityKey); return '' })
    lookup = started
    names.set(identityKey, lookup)
  }
  const found = lookup
  return new Promise<string>(resolve => {
    const timer = setTimeout(() => resolve(''), timeoutMs)
    void found.then(name => { clearTimeout(timer); resolve(name) })
  })
}

/** Name or short key. */
export async function identityLabel(wallet: WalletInterface | undefined, originator: string, identityKey: string, timeoutMs?: number): Promise<string> {
  return (await identityName(wallet, originator, identityKey, timeoutMs)) || shortKey(identityKey)
}
