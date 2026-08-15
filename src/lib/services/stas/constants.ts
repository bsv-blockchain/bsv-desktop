/**
 * BRC-42 derivation scheme for STAS owner keys.
 *
 * Receive keys are derived deterministically so a resync can regenerate every
 * key from just the persisted high-water mark. The token id is recorded after
 * discovery — never baked into the keyID — so a never-before-seen token is
 * still discoverable.
 */

/** BRC-42 protocol: security level 2, stable protocol-string namespace. */
export const STAS_PROTOCOL_ID = [2, 'stas token ownership'] as [2, string];

/** STAS owner keys are self-owned. */
export const STAS_COUNTERPARTY = 'self';

/** keyID for the Nth receive key — a monotonic counter, 1-based. */
export const stasKeyId = (index: number): string => `recv ${index}`;

/**
 * Default gap limit for ownership scans beyond the high-water mark.
 *
 * BIP-44's standard gap of 20. Kept deliberately modest because discovery
 * migrated to WhatsOnChain, where every gap address costs TWO rate-limited
 * network calls (STAS `?script=true` + DSTAS-by-hash160). The old value of 100
 * meant a scan of `hwm + 100` addresses × 2 endpoints = 200+ WOC requests at
 * 2 req/s, which reliably tripped WOC's 429 throttle — and a 429'd address
 * degrades to "empty", risking missed tokens. Tokens land at *issued*
 * addresses (≤ hwm), so a 20-address gap beyond hwm is ample coverage.
 */
export const STAS_GAP_LIMIT = 20;
