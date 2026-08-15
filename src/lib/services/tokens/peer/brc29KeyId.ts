/**
 * Encoding for a peer-received token's owner derivation, stored in the
 * `brc42KeyId` satellite column.
 *
 * A normally-discovered STAS UTXO is owned by a self-derived receive key, so
 * `brc42KeyId` is just `"recv N"` (signed with counterparty 'self'). A token
 * received over MessageBox (BRC-29) is instead owned by a key derived with
 * keyID = "<prefix> <suffix>" and counterparty = senderIdentityKey. We pack
 * those three values into the same `brc42KeyId` string so the holdings loader
 * can recover the owner derivation and the transfer service can re-spend it
 * via its `owner` override.
 *
 * Format: `brc29|<prefix>|<suffix>|<senderIdentityKey>`
 * (prefix/suffix are base64 nonces, which never contain '|').
 */
export interface Brc29Owner {
  derivationPrefix: string;
  derivationSuffix: string;
  senderIdentityKey: string;
}

const PREFIX = 'brc29|';

export function encodeBrc29KeyId(o: Brc29Owner): string {
  return `${PREFIX}${o.derivationPrefix}|${o.derivationSuffix}|${o.senderIdentityKey}`;
}

export function isBrc29KeyId(brc42KeyId: string | undefined | null): boolean {
  return typeof brc42KeyId === 'string' && brc42KeyId.startsWith(PREFIX);
}

export function decodeBrc29KeyId(brc42KeyId: string): Brc29Owner | null {
  if (!isBrc29KeyId(brc42KeyId)) return null;
  const parts = brc42KeyId.slice(PREFIX.length).split('|');
  if (parts.length !== 3) return null;
  const [derivationPrefix, derivationSuffix, senderIdentityKey] = parts;
  if (!derivationPrefix || !derivationSuffix || !senderIdentityKey) return null;
  return { derivationPrefix, derivationSuffix, senderIdentityKey };
}
