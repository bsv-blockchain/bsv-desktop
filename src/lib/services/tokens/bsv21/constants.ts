/**
 * BSV-21 protocol constants — BRC-42 derivation namespace, 1Sat REST
 * defaults, and the on-chain inscription envelope markers.
 */

/**
 * BRC-42 protocol for BSV-21 owner-key derivation. Distinct from STAS.
 *
 * Wallet-toolbox enforces `/^[a-zA-Z0-9 ]+$/` on protocol-name strings —
 * a hyphen is rejected at `getPublicKey` time with *"protocol names can
 * only contain letters, numbers and spaces"*. So `bsv21` (no hyphen)
 * rather than the canonical `bsv-21`.
 */
export const BSV21_PROTOCOL_ID = [2, 'bsv21 token ownership'] as [2, string];

/** BSV-21 owner keys are self-owned. */
export const BSV21_COUNTERPARTY = 'self';

/** keyID for the Nth receive key — monotonic counter, 1-based. */
export const bsv21KeyId = (index: number): string => `recv ${index}`;

/**
 * Default gap limit for ownership scans beyond the high-water mark.
 *
 * BIP-44's standard gap of 20 — matches STAS_GAP_LIMIT. With WOC discovery each
 * gap address is a rate-limited `/token/bsv21/{addr}/unspent` call, so the old
 * value of 100 meant `hwm + 100` requests per scan, which tripped WOC's 429
 * throttle (and a 429'd address degrades to "empty", risking missed tokens).
 * Received tokens land at issued addresses (≤ hwm); 20 beyond hwm is ample.
 */
export const BSV21_GAP_LIMIT = 20;

/** ord-inscription content type for BSV-20 / BSV-21 JSON payloads. */
export const BSV20_CONTENT_TYPE = 'application/bsv-20';

/** 1Sat REST default base URL (mainnet). Configurable per client instance. */
export const ONESAT_API_DEFAULT_MAIN = 'https://api.1sat.app';
export const ONESAT_API_DEFAULT_TEST = 'https://testnet.api.1sat.app';

/**
 * The 1Sat indexer paths use `lockType` as a path segment. P2PKH outputs
 * — the wallet-recognisable shape — use `'p2pkh'`.
 */
export const ONESAT_LOCK_TYPE_P2PKH = 'p2pkh';
