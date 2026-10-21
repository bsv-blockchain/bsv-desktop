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

const DISPLAY_LIMIT = 96

/**
 * App-supplied text (key names, reasons) as it is shown in a wallet prompt: control and format
 * characters (including bidi overrides and zero-width characters) become U+FFFD, it is cut to 96
 * code points with an ellipsis, and it is quoted so it cannot pass for the wallet's own words.
 * The prompt additionally renders it bidi-isolated and in monospace.
 */
export function displayText(value: string): string {
  const characters = Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, '�'))
  const shown = characters.length > DISPLAY_LIMIT ? `${characters.slice(0, DISPLAY_LIMIT).join('')}…` : characters.join('')
  return `“${shown}”`
}

export type RabinPromptRow = { label: string; value: string; mono?: boolean }

export type RabinPromptCopy = { title: string; description: string; rows: RabinPromptRow[]; scope: string }

const formatBytes = (length: number) => length === 1 ? '1 byte' : `${length.toLocaleString('en-US')} bytes`

/** Everything the Rabin prompt says for one parsed request. */
export function rabinPromptCopy(app: string, prompt: RabinPromptMessage): RabinPromptCopy {
  const isSign = prompt.type === 'rabin_sign'
  const rows: RabinPromptRow[] = [
    { label: 'Protocol', value: displayText(prompt.logicalProtocolID), mono: true },
    { label: 'Key name', value: displayText(prompt.keyID), mono: true },
    { label: 'Key size', value: `${prompt.bits}-bit Rabin` }
  ]
  if (prompt.counterparty !== 'self') {
    rows.push({ label: 'Shared with', value: prompt.counterparty === 'anyone' ? 'Anyone' : prompt.counterparty, mono: prompt.counterparty !== 'anyone' })
  }
  if (prompt.privilegedReason !== undefined) {
    rows.push({ label: 'Privileged reason', value: displayText(prompt.privilegedReason), mono: true })
  }
  if (isSign) {
    rows.push({ label: 'Data to sign', value: formatBytes(prompt.messageLength!) })
    rows.push({ label: 'Fingerprint of this data (SHA-256)', value: prompt.messageSha256!, mono: true })
  }
  const scope = `If you allow, for the next ${RABIN_GRANT_MINUTES} minutes ${app} can get any “${prompt.logicalProtocolID}” key and sign any data with it, without asking again. The private key never leaves your wallet.`
  return {
    title: isSign ? `Allow ${app} to sign with a key in your wallet?` : `Allow ${app} to use a signing key in your wallet?`,
    description: isSign
      ? 'The app wants your wallet to sign some data. Contracts that trust this key will accept the signature as coming from you.'
      : 'The app wants the public half of a signing key held in your wallet, so that contracts can check signatures made with it.',
    rows,
    scope: isSign ? `${scope} Later signatures in those ${RABIN_GRANT_MINUTES} minutes are not shown.` : scope
  }
}
