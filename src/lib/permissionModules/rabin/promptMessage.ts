import type { RabinAuthorizationRequest } from '@bsv/rabin-permission-module'

/** How long an approval lasts; the module and the prompt text use the same value. */
export const RABIN_GRANT_MINUTES = 5

/** The JSON a Rabin authorization request is sent to the desktop prompt as. */
export type RabinPromptMessage = {
  type: 'rabin_key' | 'rabin_sign'
  originator: string
  securityLevel: 0 | 1 | 2
  logicalProtocolID: string
  keyID: string
  counterparty: string
  bits: number
  privilegedReason?: string
  messageLength?: number
  messageSha256?: string
}

export function toRabinPromptMessage(request: RabinAuthorizationRequest): RabinPromptMessage {
  return {
    type: request.operation === 'sign' ? 'rabin_sign' : 'rabin_key',
    originator: request.originator,
    securityLevel: request.securityLevel,
    logicalProtocolID: request.logicalProtocolID,
    keyID: request.keyID,
    counterparty: request.counterparty,
    bits: request.bits,
    ...(request.privileged ? { privilegedReason: request.privilegedReason } : {}),
    ...(request.operation === 'sign'
      ? { messageLength: request.messageLength, messageSha256: request.messageSha256 }
      : {})
  }
}

const isText = (value: unknown, max = 1024): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

/** Parses a prompt message; anything incomplete or malformed returns null and cannot be approved. */
export function parseRabinPromptMessage(message: string): RabinPromptMessage | null {
  let value: Record<string, unknown>
  try {
    value = JSON.parse(message)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.type !== 'rabin_key' && value.type !== 'rabin_sign') return null
  if (value.securityLevel !== 0 && value.securityLevel !== 1 && value.securityLevel !== 2) return null
  if (value.bits !== 2048 && value.bits !== 3072 && value.bits !== 4096) return null
  if (!isText(value.originator) || !isText(value.logicalProtocolID, 272) || !isText(value.keyID, 800) || !isText(value.counterparty, 66)) return null
  if (value.privilegedReason !== undefined && !isText(value.privilegedReason, 50)) return null
  if (value.type === 'rabin_sign') {
    if (typeof value.messageLength !== 'number' || !Number.isSafeInteger(value.messageLength) || value.messageLength < 0) return null
    if (typeof value.messageSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.messageSha256)) return null
  }
  return value as unknown as RabinPromptMessage
}
