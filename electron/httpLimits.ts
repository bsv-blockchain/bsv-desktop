/**
 * JSON / text body limit for the BRC-100 HTTP bridge (port 3321).
 *
 * D30: it must stay at least 32 MiB. A BRC-207 `p color` receipt carries up to
 * 16 MiB of `customInstructions` per call (D29), and JSON byte arrays (`tx`,
 * BEEF) expand roughly 3-4x over the wire, so 50 MiB leaves room for a full
 * attested receipt plus its transaction.
 */
export const HTTP_JSON_BODY_LIMIT = '50mb'
