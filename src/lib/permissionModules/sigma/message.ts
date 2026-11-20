/**
 * The message the permission prompt receives for one sigma authorization
 * request: a versioned JSON string with a fixed key order, so the same
 * request always gives the same string and the prompt can parse it back.
 *
 * The originator is not carried: the prompt handler receives it separately.
 * Privileged fields are not carried either: privileged requests are refused
 * before a message is built.
 */

import type { SigmaAuthorizationRequest } from '@bsv/sigma-permission-module'

export type SigmaPromptRequest = {
  operation: 'key' | 'schnorr' | 'dleq' | 'or'
  applicationBase: boolean
  securityLevel: 1 | 2
  logicalProtocolID: string
  keyID: string
  counterparty: string            // 'self', 'anyone' or a 66-hex public key
  contextSha256?: string          // 64 hex, proofs only
  inputSha256: string             // 64 hex
}

const VERSION = 1
const OPERATIONS: ReadonlySet<unknown> = new Set(['key', 'schnorr', 'dleq', 'or'])
const SHA256_HEX = /^[0-9a-f]{64}$/
const COMPRESSED_KEY_HEX = /^0[23][0-9a-f]{64}$/
const REQUIRED_KEYS = ['v', 'operation', 'applicationBase', 'securityLevel', 'logicalProtocolID', 'keyID', 'counterparty', 'inputSha256']

/**
 * `{"v":1, operation, applicationBase, securityLevel, logicalProtocolID,
 * keyID, counterparty, contextSha256?, inputSha256}`, in that order;
 * `contextSha256` is omitted when the request has none (a `key` request).
 * The one serializer: the parser accepts only what this produces.
 */
function serialize (request: SigmaPromptRequest): string {
  return JSON.stringify({
    v: VERSION,
    operation: request.operation,
    applicationBase: request.applicationBase,
    securityLevel: request.securityLevel,
    logicalProtocolID: request.logicalProtocolID,
    keyID: request.keyID,
    counterparty: request.counterparty,
    ...(request.contextSha256 === undefined ? {} : { contextSha256: request.contextSha256 }),
    inputSha256: request.inputSha256
  })
}

/**
 * The message for `request`, in the form `serialize` gives. The request is
 * expected at security level 1 or 2.
 */
export function sigmaPromptMessage (request: SigmaAuthorizationRequest): string {
  return serialize({
    operation: request.operation,
    applicationBase: request.applicationBase,
    securityLevel: request.securityLevel as SigmaPromptRequest['securityLevel'],
    logicalProtocolID: request.logicalProtocolID,
    keyID: request.keyID,
    counterparty: request.counterparty,
    contextSha256: request.contextSha256,
    inputSha256: request.inputSha256
  })
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== ''

const isCounterparty = (value: unknown): value is string =>
  value === 'self' || value === 'anyone' || (typeof value === 'string' && COMPRESSED_KEY_HEX.test(value))

/**
 * The request a message describes, or undefined unless it is version-1 JSON
 * with exactly the expected fields, each of the right type and shape:
 * a known operation, level 1 or 2, non-empty protocol and key ID, a valid
 * counterparty, lowercase 64-hex hashes, and a context hash present for
 * proofs and absent for `key`, and `applicationBase` as the operation
 * requires it (true for `dleq`, false for `schnorr` and `or`, either for
 * `key`). The message must also be exactly the string `sigmaPromptMessage`
 * gives for the request it describes. Never throws.
 */
export function parseSigmaPromptMessage (message: string): SigmaPromptRequest | undefined {
  if (typeof message !== 'string') return undefined
  let value: unknown
  try {
    value = JSON.parse(message)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const fields = value as Record<string, unknown>
  const keys = Object.keys(fields)
  const isProof = fields.operation !== 'key'
  const expected = isProof ? [...REQUIRED_KEYS, 'contextSha256'] : REQUIRED_KEYS
  if (keys.length !== expected.length || !expected.every(k => Object.prototype.hasOwnProperty.call(fields, k))) return undefined

  const { v, operation, applicationBase, securityLevel, logicalProtocolID, keyID, counterparty, contextSha256, inputSha256 } = fields
  if (v !== VERSION) return undefined
  if (!OPERATIONS.has(operation)) return undefined
  if (typeof applicationBase !== 'boolean') return undefined
  if (securityLevel !== 1 && securityLevel !== 2) return undefined
  if (!isNonEmptyString(logicalProtocolID) || !isNonEmptyString(keyID)) return undefined
  if (!isCounterparty(counterparty)) return undefined
  if (typeof inputSha256 !== 'string' || !SHA256_HEX.test(inputSha256)) return undefined
  if (isProof && (typeof contextSha256 !== 'string' || !SHA256_HEX.test(contextSha256))) return undefined
  if (operation === 'dleq' && applicationBase !== true) return undefined
  if ((operation === 'schnorr' || operation === 'or') && applicationBase !== false) return undefined

  const request: SigmaPromptRequest = {
    operation: operation as SigmaPromptRequest['operation'],
    applicationBase,
    securityLevel,
    logicalProtocolID,
    keyID,
    counterparty,
    ...(isProof ? { contextSha256: contextSha256 as string } : {}),
    inputSha256
  }
  return serialize(request) === message ? request : undefined
}
