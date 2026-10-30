/**
 * Consent view model for the color permission module's consent messages
 * (`requestTokenAccess(originator, JSON)`, contract §2.5), with exact token
 * amount formatting.
 *
 * Token amounts are canonical decimal strings (contract §0). They are checked
 * with a regex BEFORE any BigInt conversion, because `BigInt('')`,
 * `BigInt('01')`, `BigInt(' 1')` and `BigInt(1500)` all succeed and would let
 * a malformed message render a figure. A per-output amount is bounded to
 * 0..2^64-1 (0162:139-141); sums are unbounded exact integers (0162:143).
 * Floats never touch a token amount; the host-safe integer checks are used
 * only for satoshis, indices, counts and `dec`.
 *
 * Display metadata (`hostDisplay`, Task 11) is untrusted (0207:960-962,
 * 0162 "Display spoofing"): the full asset id is always part of the name, and
 * a malformed display entry is ignored for display (0207 A.38), which falls
 * back to exact base units.
 *
 * Fail closed: anything the view reads that does not have the expected shape
 * throws `InvalidColorRequestError` naming the field. Members the view does
 * not read (`seekPermission`, `lockingScript`, future additions) are ignored.
 */

/** Host-resolved display metadata for one asset (Task 11). Untrusted. */
export interface AssetDisplay {
  assetId: string
  sym?: string
  label?: string
  dec: number
  mandala: boolean
}

export type ColorConsentType =
  | 'color_send'
  | 'color_signature'
  | 'color_access'
  | 'color_relinquish'

export interface ColorConsentView {
  type: ColorConsentType
  title: string
  originatorNote?: string
  handoff: boolean
  assets: Array<{
    assetId: string
    name: string
    operations: string[]
    lines: Array<{ label: string, amount: string }>
    /** Authority outputs moved by this action, shown only when non-zero (0207:960). */
    authorities: Array<{ label: string, count: number }>
  }>
  /** The deploy this action creates, when it creates one. Amount in base units (no display for ISSUE). */
  deploy?: { operation: string, amount: string, owned: boolean }
  destinations: Array<{
    outputIndex: number
    satoshis: number
    token?: { assetId: string, role: string, amount: string }
  }>
  satoshis?: { inputs: number, outputs: number, fee: number }
  signatures: Array<{ outpoint: string, inputIndex: number, sighashType: number }>
  lockTime?: number
  access?: { basket?: string, labels?: string[], assetId?: string, role?: string }
  relinquish?: { assetId: string, role: string, outpoint: string }
}

/** A consent message the view cannot present faithfully. Matched by `.name` (D22). */
export class InvalidColorRequestError extends Error {
  constructor (message: string) {
    super(`[InvalidColorRequestError] ${message}`)
    this.name = 'InvalidColorRequestError'
  }
}

const AMOUNT = /^(0|[1-9][0-9]*)$/
const ASSET_ID = /^[0-9a-f]{64}_(0|[1-9][0-9]{0,9})$/
const OUTPOINT = /^[0-9a-f]{64}\.(0|[1-9][0-9]{0,9})$/
const IDENTITY_KEY = /^0[23][0-9a-f]{64}$/
const UINT64_MAX = 18446744073709551615n
const UINT32_MAX = 4294967295
const MAX_ASSETS = 64
const MAX_DESTINATIONS = 1000
const ROLES: ReadonlySet<string> = new Set(['value', 'authority'])

const TITLES: Record<ColorConsentType, string> = {
  color_send: 'Approve token transaction',
  color_signature: 'Approve token signature',
  color_access: 'Share token holdings',
  color_relinquish: 'Remove a token holding'
}
const HANDOFF_TITLE = 'Approve token hand-over'

/**
 * Exact fixed-point rendering of `units` with `dec` decimals. The fraction is
 * padded to `dec` digits and keeps trailing zeros, so the integer is always
 * recoverable from the text.
 */
export function formatUnits (units: bigint, dec: number): string {
  if (typeof units !== 'bigint' || units < 0n) throw new RangeError('units must be a non-negative bigint')
  if (!Number.isInteger(dec) || dec < 0 || dec > 18) throw new RangeError('dec must be an integer 0..18')
  const digits = units.toString()
  if (dec === 0) return digits
  const padded = digits.padStart(dec + 1, '0')
  return `${padded.slice(0, -dec)}.${padded.slice(-dec)}`
}

/** `units` (a canonical decimal string) with the asset's decimals and symbol, else in base units. */
export function formatTokenAmount (units: string, display?: AssetDisplay): string {
  if (typeof units !== 'string' || !AMOUNT.test(units)) throw new RangeError('units must be a canonical decimal string')
  if (display === undefined) return `${units} base units`
  const text = formatUnits(BigInt(units), display.dec)
  return typeof display.sym === 'string' && display.sym !== '' ? `${text} ${display.sym}` : text
}

// ---------------------------------------------------------------------------
// Field readers. Each throws InvalidColorRequestError naming `path`.

type Json = Record<string, unknown>

const fail = (path: string, what: string): never => {
  throw new InvalidColorRequestError(`${path} ${what}`)
}

const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)

const has = (o: Json, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key) && o[key] !== undefined

function obj (v: unknown, path: string): Json {
  if (!isObject(v)) fail(path, 'must be an object')
  return v as Json
}

function arr (v: unknown, path: string, max?: number): unknown[] {
  if (!Array.isArray(v)) fail(path, 'must be an array')
  const a = v as unknown[]
  if (max !== undefined && a.length > max) fail(path, `must have at most ${max} entries`)
  return a
}

function str (v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'must be a string')
  return v as string
}

function bool (v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'must be a boolean')
  return v as boolean
}

/** A safe non-negative integer (satoshis, indices, counts). Never a token amount. */
function uint (v: unknown, path: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max) fail(path, `must be an integer 0..${max}`)
  return v as number
}

/** A token sum: canonical decimal string, unbounded. */
function amount (v: unknown, path: string): string {
  if (typeof v !== 'string' || !AMOUNT.test(v)) fail(path, 'must be a canonical decimal string')
  return v as string
}

/** A per-output token amount: canonical decimal string, 0..2^64-1. */
function outputAmount (v: unknown, path: string): string {
  const a = amount(v, path)
  if (BigInt(a) > UINT64_MAX) fail(path, 'exceeds 2^64-1')
  return a
}

function assetId (v: unknown, path: string): string {
  const s = str(v, path)
  if (!ASSET_ID.test(s)) fail(path, 'must be an asset id <64 hex>_<vout>')
  return s
}

function outpoint (v: unknown, path: string): string {
  const s = str(v, path)
  if (!OUTPOINT.test(s)) fail(path, 'must be an outpoint <64 hex>.<vout>')
  return s
}

function role (v: unknown, path: string): string {
  const s = str(v, path)
  if (!ROLES.has(s)) fail(path, "must be 'value' or 'authority'")
  return s
}

function identityKey (v: unknown, path: string): string {
  const s = str(v, path)
  if (!IDENTITY_KEY.test(s)) fail(path, 'must be a compressed identity key')
  return s
}

function strings (v: unknown, path: string): string[] {
  return arr(v, path).map((s, i) => str(s, `${path}[${i}]`))
}

// ---------------------------------------------------------------------------

/**
 * Display entries the host attached. A malformed or mismatched entry is
 * ignored for display (0207 A.38), so its amounts show in exact base units.
 */
function readDisplays (v: unknown): Map<string, AssetDisplay> {
  const out = new Map<string, AssetDisplay>()
  if (!isObject(v)) return out
  for (const key of Object.keys(v)) {
    const d = v[key]
    if (!isObject(d)) continue
    if (d.assetId !== key || !ASSET_ID.test(key)) continue
    if (typeof d.dec !== 'number' || !Number.isInteger(d.dec) || d.dec < 0 || d.dec > 18) continue
    out.set(key, {
      assetId: key,
      dec: d.dec,
      mandala: d.mandala === true,
      ...(typeof d.sym === 'string' && d.sym !== '' ? { sym: d.sym } : {}),
      ...(typeof d.label === 'string' && d.label !== '' ? { label: d.label } : {})
    })
  }
  return out
}

function assetName (id: string, display: AssetDisplay | undefined): string {
  const shown = display?.label ?? display?.sym
  return shown === undefined ? id : `${shown} (${id})`
}

function readAssets (v: unknown, displays: Map<string, AssetDisplay>): ColorConsentView['assets'] {
  return arr(v, 'assets', MAX_ASSETS).map((raw, i) => {
    const p = `assets[${i}]`
    const a = obj(raw, p)
    const id = assetId(a.assetId, `${p}.assetId`)
    const display = displays.get(id)
    const fmt = (units: string): string => formatTokenAmount(units, display)
    const sending = amount(a.outgoingAmount, `${p}.outgoingAmount`)
    const legs: Array<[string, string]> = [
      ['From this wallet', amount(a.inputAmount, `${p}.inputAmount`)],
      ['From others', amount(a.foreignAmount, `${p}.foreignAmount`)],
      ['Kept as change', amount(a.keptAmount, `${p}.keptAmount`)],
      ['Burned', amount(a.burned, `${p}.burned`)],
      ['Minted', amount(a.minted, `${p}.minted`)]
    ]
    amount(a.transferred, `${p}.transferred`)
    const authorities: Array<[string, number]> = [
      ['Authorities sending', uint(a.outgoingAuthorities, `${p}.outgoingAuthorities`)],
      ['Authorities from this wallet', uint(a.authorityInputs, `${p}.authorityInputs`)],
      ['Authorities from others', uint(a.foreignAuthorityInputs, `${p}.foreignAuthorityInputs`)],
      ['Authorities kept', uint(a.keptAuthorities, `${p}.keptAuthorities`)]
    ]
    return {
      assetId: id,
      name: assetName(id, display),
      operations: strings(a.operations, `${p}.operations`),
      lines: [
        { label: 'Sending', amount: fmt(sending) },
        ...legs.filter(([, units]) => units !== '0').map(([label, units]) => ({ label, amount: fmt(units) }))
      ],
      authorities: authorities.filter(([, count]) => count !== 0).map(([label, count]) => ({ label, count }))
    }
  })
}

function readDestinations (v: unknown, displays: Map<string, AssetDisplay>): ColorConsentView['destinations'] {
  return arr(v, 'destinations', MAX_DESTINATIONS).map((raw, i) => {
    const p = `destinations[${i}]`
    const d = obj(raw, p)
    const out: ColorConsentView['destinations'][number] = {
      outputIndex: uint(d.outputIndex, `${p}.outputIndex`, UINT32_MAX),
      satoshis: uint(d.satoshis, `${p}.satoshis`)
    }
    const tokenMembers = ['assetId', 'role', 'amount'].filter(k => has(d, k))
    if (tokenMembers.length === 0) return out
    if (tokenMembers.length !== 3) fail(p, 'must carry assetId, role and amount together')
    const id = d.assetId === 'ISSUE' ? 'ISSUE' : assetId(d.assetId, `${p}.assetId`)
    const units = outputAmount(d.amount, `${p}.amount`)
    out.token = {
      assetId: id,
      role: role(d.role, `${p}.role`),
      amount: formatTokenAmount(units, id === 'ISSUE' ? undefined : displays.get(id))
    }
    return out
  })
}

function readSatoshis (v: unknown): NonNullable<ColorConsentView['satoshis']> {
  const s = obj(v, 'satoshis')
  const inputs = uint(s.inputs, 'satoshis.inputs')
  const outputs = uint(s.outputs, 'satoshis.outputs')
  const fee = uint(s.fee, 'satoshis.fee')
  if (inputs - outputs !== fee) fail('satoshis.fee', 'must equal inputs - outputs')
  return { inputs, outputs, fee }
}

function readSignatures (v: unknown): ColorConsentView['signatures'] {
  return arr(v, 'signatures').map((raw, i) => {
    const p = `signatures[${i}]`
    const s = obj(raw, p)
    return {
      outpoint: outpoint(s.outpoint, `${p}.outpoint`),
      inputIndex: uint(s.inputIndex, `${p}.inputIndex`, UINT32_MAX),
      sighashType: uint(s.sighashType, `${p}.sighashType`, 255)
    }
  })
}

function readDeploy (v: unknown): NonNullable<ColorConsentView['deploy']> {
  const d = obj(v, 'deploy')
  return {
    operation: str(d.operation, 'deploy.operation'),
    amount: formatTokenAmount(outputAmount(d.amount, 'deploy.amount')),
    owned: bool(d.owned, 'deploy.owned')
  }
}

function readAccess (m: Json): NonNullable<ColorConsentView['access']> {
  const access: NonNullable<ColorConsentView['access']> = {}
  if (has(m, 'basket')) access.basket = str(m.basket, 'basket')
  if (has(m, 'labels')) access.labels = strings(m.labels, 'labels')
  if (has(m, 'assetId')) access.assetId = assetId(m.assetId, 'assetId')
  if (has(m, 'role')) access.role = role(m.role, 'role')
  return access
}

/** Parses and validates one consent message into what the prompt shows. */
export function buildColorConsentView (message: string): ColorConsentView {
  let parsed: unknown
  try {
    parsed = JSON.parse(message)
  } catch {
    throw new InvalidColorRequestError('message is not JSON')
  }
  const m = obj(parsed, 'message')
  const type = m.type
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(TITLES, type)) {
    return fail('type', 'is not a color consent type')
  }
  const kind = type as ColorConsentType
  const displays = readDisplays(m.hostDisplay)
  const view: ColorConsentView = {
    type: kind,
    title: TITLES[kind],
    handoff: false,
    assets: [],
    destinations: [],
    signatures: []
  }

  switch (kind) {
    case 'color_send':
    case 'color_signature': {
      if (kind === 'color_send' && has(m, 'handoff')) view.handoff = bool(m.handoff, 'handoff')
      if (kind === 'color_signature') uint(m.inputIndex, 'inputIndex', UINT32_MAX)
      if (view.handoff) view.title = HANDOFF_TITLE
      view.assets = readAssets(m.assets, displays)
      if (has(m, 'deploy')) view.deploy = readDeploy(m.deploy)
      view.destinations = readDestinations(m.destinations, displays)
      view.satoshis = readSatoshis(m.satoshis)
      view.signatures = readSignatures(m.signatures)
      if (has(m, 'lockTime')) view.lockTime = uint(m.lockTime, 'lockTime', UINT32_MAX)
      break
    }
    case 'color_access':
      view.access = readAccess(m)
      break
    case 'color_relinquish':
      view.relinquish = {
        assetId: assetId(m.assetId, 'assetId'),
        role: role(m.role, 'role'),
        outpoint: outpoint(m.outpoint, 'outpoint')
      }
      break
  }
  return view
}
