/**
 * `ListOutputsResult.totalOutputs` is `number | DecimalString` since @bsv/sdk 4.0
 * (a BRC-112 module balance arrives as exact decimal text). Every place the
 * desktop uses it as a count or a satoshi total reads it through here, so a
 * value that is not an exact safe integer is refused instead of becoming a
 * wrong number or a string concatenation.
 */
const CANONICAL_DECIMAL = /^(0|[1-9][0-9]*)$/

export function readCount (value: number | string, what: string): number {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return value
  } else if (typeof value === 'string' && CANONICAL_DECIMAL.test(value)) {
    // Compare as exact integers before converting: the regex bounds the shape,
    // BigInt bounds the magnitude, so the conversion below is lossless.
    if (BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value)
  }
  throw new Error(`${what} is not a safe non-negative integer count`)
}
