/**
 * JSON / text body limit for the BRC-100 HTTP bridge (port 3321).
 *
 * BRC-207 receipts are plain custody JSON of at most 1000 bytes (design §9
 * B7), but JSON byte arrays (`tx`, BEEF with every unconfirmed ancestor)
 * expand roughly 3-4x over the wire, so the 50 MiB limit is kept.
 */
export const HTTP_JSON_BODY_LIMIT = '50mb'
