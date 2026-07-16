/**
 * AssetsPage — production-facing wallet view for STAS holdings.
 *
 * Replaces the dev panel's "My STAS" surface with a token-grouped layout:
 * one card per (symbol, tokenId) bucket, expandable to show the underlying
 * UTXOs, with explicit Send and Receive flows.
 *
 * Reads + writes through the same internal services the Apps API exposes
 * externally. This page is the user-facing surface for token holdings.
 */

import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import SendIcon from '@mui/icons-material/Send'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import TokenIcon from '@mui/icons-material/Token'
import VerifiedIcon from '@mui/icons-material/Verified'
import GppBadIcon from '@mui/icons-material/GppBad'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
import SearchIcon from '@mui/icons-material/Search'
import { QRCodeSVG } from 'qrcode.react'
import { Address, fromHex } from 'dxs-bsv-token-sdk/bsv'
import { WalletContext } from '../../WalletContext'
import { stasQuery } from '../../services/stas'
import type { TokenProtocolId, Bsv21SendExtras } from '../../services/tokens'
import { parseBsv21LockingScript } from '../../services/tokens'
import { BSV21_BASKET } from '../../constants/baskets'
import {
  TokenVerificationService,
  aggregateBadge,
  type OutpointVerification,
  type VerificationBadge,
} from '../../services/tokens/TokenVerificationService'

interface OutputView {
  outpoint: string
  txid: string
  vout: number
  satoshis: number
  spendable: boolean
  tokenId: string
  symbol: string | null
  name: string | null
  brc42KeyId: string | null
  ownerFieldHash160: string
  ownerAddress: string
  scriptHex: string | null
  frozen: boolean
  confiscated: boolean
  /** Set when wallet-toolbox marked this row as spent (consumed by a tx). */
  spentBy: string | null
  /** ISO timestamp from stas_outputs.createdAt — used for activity ordering. */
  createdAt: string | null
  /** Which token protocol this UTXO belongs to. */
  protocol: TokenProtocolId
  /**
   * Raw token amount (stringified bigint). For STAS/DSTAS this is `satoshis`
   * since their satoshisPerToken=1. For BSV-21 it's the `amt` field parsed
   * from the basket tag, which may be much larger than the 1-sat output.
   */
  tokenAmount: string
  /** Decimal precision for display. Zero for STAS/DSTAS. */
  decimals: number
  /** Optional icon URL/outpoint for BSV-21. */
  icon: string | null
  /** Back-to-Genesis verdict for this outpoint; undefined until verified. */
  verification?: OutpointVerification
}

interface TokenGroup {
  groupKey: string
  symbol: string
  name: string | null
  tokenIds: Set<string>
  outputCount: number
  totalSatoshis: number
  spendableSatoshis: number
  outputs: OutputView[]
  /** Protocol this group represents — distinct protocols never merge. */
  protocol: TokenProtocolId
  /**
   * Resolved genesis outpoints across this group's UTXOs. For classic STAS the
   * tokenId is only the issuer PKH (shared by every token that issuer minted),
   * so the genesis is the real identity — a group keyed on it can't be spoofed
   * by a same-symbol relabel. Empty until B2G verification resolves.
   */
  genesisSet: Set<string>
  /** Card-level provenance rollup (worst outpoint verdict wins). */
  badge: VerificationBadge
  /** Sum of `tokenAmount` across outputs in this group (stringified bigint). */
  tokenAmount: string
  /** Same, but only for spendable outputs. */
  spendableTokenAmount: string
  /** Decimal precision for display, taken from the first output. */
  decimals: number
}

/**
 * Parse a stringified bigint defensively. BSV-21 `amt` tags come from
 * arbitrary minter input and can be anything — non-numeric values used
 * to crash the entire AssetsPage at the `BigInt()` call site. Return
 * `0n` for anything that doesn't parse so the row still renders.
 */
function safeBigInt(s: string | null | undefined): bigint {
  if (!s) return 0n
  try {
    return BigInt(s)
  } catch {
    return 0n
  }
}

function groupByToken(outputs: OutputView[]): TokenGroup[] {
  const byKey = new Map<string, TokenGroup>()
  for (const o of outputs) {
    // Identity key. Prefer the resolved genesis outpoint: for classic STAS the
    // tokenId is just the issuer PKH, so two genuinely different tokens from one
    // issuer share it — and a counterfeit deliberately reuses it. Keying on
    // genesis keeps EXSTAS2 (or a forgery) from collapsing into EXSTAS1's card.
    // Falls back to (protocol, symbol, tokenId) until verification resolves.
    const genesis = o.verification?.genesis
    const key = genesis
      ? `${o.protocol}::genesis::${genesis}`
      : o.tokenId
        ? `${o.protocol}::${o.symbol ?? '?'}::${o.tokenId}`
        : `${o.protocol}::${o.symbol ?? 'unknown'}`
    let g = byKey.get(key)
    if (!g) {
      g = {
        groupKey: key,
        symbol: o.symbol ?? 'unknown',
        name: o.name,
        tokenIds: new Set(),
        outputCount: 0,
        totalSatoshis: 0,
        spendableSatoshis: 0,
        outputs: [],
        protocol: o.protocol,
        tokenAmount: '0',
        spendableTokenAmount: '0',
        decimals: o.decimals,
        genesisSet: new Set(),
        badge: 'unknown',
      }
      byKey.set(key, g)
    }
    g.outputCount += 1
    g.totalSatoshis += o.satoshis
    if (o.spendable) g.spendableSatoshis += o.satoshis
    // BigInt sums for token amounts — BSV-21 values can exceed JS's safe-int.
    // `safeBigInt` defends against malformed amt tags (e.g. someone minted
    // BSV-21 with `amt: "lorem ipsum"`); we keep the row visible at 0.
    g.tokenAmount = (safeBigInt(g.tokenAmount) + safeBigInt(o.tokenAmount)).toString()
    if (o.spendable) {
      g.spendableTokenAmount = (safeBigInt(g.spendableTokenAmount) + safeBigInt(o.tokenAmount)).toString()
    }
    if (o.tokenId) g.tokenIds.add(o.tokenId)
    if (genesis) g.genesisSet.add(genesis)
    if (!g.name && o.name) g.name = o.name
    g.outputs.push(o)
  }
  // Compute each card's provenance rollup from its outputs' verdicts.
  for (const g of byKey.values()) {
    g.badge = aggregateBadge(
      g.outputs.map((o) => o.verification).filter((v): v is OutpointVerification => !!v)
    )
  }
  // Sort by spendable-amount descending. BigInt-safe comparator.
  return Array.from(byKey.values()).sort((a, b) => {
    const av = safeBigInt(a.tokenAmount)
    const bv = safeBigInt(b.tokenAmount)
    return av < bv ? 1 : av > bv ? -1 : 0
  })
}

/**
 * Format a raw token amount (stringified bigint) with the protocol's
 * decimal precision. `dec=0` is the STAS/DSTAS case — render the integer
 * with locale separators. `dec>0` is BSV-21 — divide by 10^dec and trim
 * trailing zeros so 1500000 with dec=6 reads as "1.5", not "1.500000".
 */
function formatTokenAmount(amount: string, dec: number): string {
  // Defensive: malformed `amt` tags (non-numeric strings, e.g. when a mint
  // call accidentally passed "lorem ipsum") show as `?` rather than crashing.
  let n: bigint
  try { n = BigInt(amount || '0') } catch { return amount ? `? (${amount})` : '0' }
  if (dec === 0) return n.toLocaleString()
  const divisor = 10n ** BigInt(dec)
  const integer = n / divisor
  const fraction = n % divisor
  const intStr = integer.toLocaleString()
  const fracPadded = fraction.toString().padStart(dec, '0')
  const fracTrimmed = fracPadded.replace(/0+$/, '')
  return fracTrimmed ? `${intStr}.${fracTrimmed}` : intStr
}

/** Extract tag values like `id:abc` → `abc`. Returns undefined if absent. */
function tagValue(tags: string[] | undefined, prefix: string): string | undefined {
  if (!tags) return undefined
  for (const t of tags) {
    if (t.startsWith(prefix + ':')) return t.slice(prefix.length + 1)
  }
  return undefined
}

/** Parse customInstructions JSON safely; returns null if malformed. */
function parseCustomInstructions(s: string | null | undefined): any | null {
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}

/**
 * Shape a wallet-toolbox `listOutputs` row from the `bsv-21-tokens` basket
 * into the unified `OutputView`. Token-level metadata (id, amt, dec, sym,
 * icon) lives on basket TAGS per 1sat-toolbox convention; BRC-42 unlock
 * context lives in customInstructions.
 */
function bsv21RowToView(o: any): OutputView {
  const tags: string[] | undefined = o.tags
  const tokenId = tagValue(tags, 'id') ?? ''
  const amt = tagValue(tags, 'amt') ?? '0'
  const decStr = tagValue(tags, 'dec')
  const decimals = decStr ? Number(decStr) : 0
  const sym = tagValue(tags, 'sym') ?? null
  const icon = tagValue(tags, 'icon') ?? null

  const ci = parseCustomInstructions(o.customInstructions)
  const brc42KeyId = (ci && typeof ci.keyID === 'string') ? ci.keyID : null
  const ownerAddrFromCI = (ci && typeof ci.ownerAddress === 'string') ? ci.ownerAddress : null

  // Locking script may include the full ord envelope; parse to recover the
  // P2PKH owner hash160. Fall back to customInstructions for the address.
  const scriptHex: string | null = o.lockingScript ?? null
  const parsed = scriptHex ? parseBsv21LockingScript(scriptHex) : null

  const [txid, voutStr] = (o.outpoint ?? '.').split('.')
  const vout = Number(voutStr)

  return {
    outpoint: o.outpoint,
    txid,
    vout: Number.isNaN(vout) ? 0 : vout,
    satoshis: o.satoshis ?? 1,
    spendable: !!o.spendable,
    tokenId,
    symbol: sym,
    name: null,
    brc42KeyId,
    ownerFieldHash160: parsed?.ownerHash160 ?? '',
    ownerAddress: ownerAddrFromCI ?? (parsed ? hash160ToAddress(parsed.ownerHash160) : ''),
    scriptHex,
    frozen: false,
    confiscated: false,
    spentBy: null,
    createdAt: o.createdAt ?? null,
    protocol: 'bsv-21',
    tokenAmount: amt,
    decimals,
    icon,
  }
}

/** Display label for the protocol badge chip. */
function protocolLabel(p: TokenProtocolId): string {
  switch (p) {
    case 'stas': return 'STAS'
    case 'dstas': return 'DSTAS'
    case 'bsv-21': return 'BSV-21'
  }
}

/**
 * Back-to-Genesis provenance chip for a token card.
 *
 * - verified    → green: every UTXO traced to a genesis mint.
 * - counterfeit → red: at least one UTXO failed a provenance rule (does not
 *   descend from a real mint). The dangerous case — the reason is shown.
 * - unknown     → grey. Distinguish "still checking" (a UTXO not yet verified)
 *   from "couldn't decide" (B2G returned undetermined — a deep chain or an
 *   unavailable source). Neither is a counterfeit; both fail safe.
 */
function TokenVerificationChip({ group, onReverify }: { group: TokenGroup; onReverify?: () => void }) {
  const pending = group.outputs.some((o) => !o.verification)
  if (pending && group.badge !== 'counterfeit') {
    // Mid-flight — no re-verify affordance while a check is already running.
    return (
      <Chip
        size='small'
        variant='outlined'
        icon={<CircularProgress size={12} />}
        label='Verifying…'
      />
    )
  }
  // A settled badge is never re-checked automatically. Clicking it is the
  // explicit re-verify — stop the click from also toggling the card's expand.
  const reverify = onReverify
    ? (e: React.MouseEvent) => {
        e.stopPropagation()
        onReverify()
      }
    : undefined
  const hint = reverify ? ' · click to re-verify' : ''

  if (group.badge === 'verified') {
    const genesis = [...group.genesisSet][0]
    return (
      <Tooltip title={`${genesis ? `Provenance verified to genesis ${genesis}` : 'Provenance verified to its genesis mint'}${hint}`}>
        <Chip size='small' color='success' variant='outlined' icon={<VerifiedIcon />} label='Verified' onClick={reverify} clickable={!!reverify} />
      </Tooltip>
    )
  }
  if (group.badge === 'counterfeit') {
    const reason = group.outputs.find((o) => o.verification?.result === 'not-authentic')?.verification?.reason
    return (
      <Tooltip title={`Does not descend from a genuine mint${reason ? ` (${reason})` : ''} — do not trust${hint}`}>
        <Chip size='small' color='error' variant='filled' icon={<GppBadIcon />} label='Counterfeit' onClick={reverify} clickable={!!reverify} />
      </Tooltip>
    )
  }
  return (
    <Tooltip title={`Provenance could not be determined — treat as unverified, not as fake${hint}`}>
      <Chip size='small' variant='outlined' icon={<HelpOutlineIcon />} label='Unverified' onClick={reverify} clickable={!!reverify} />
    </Tooltip>
  )
}

function hash160ToAddress(hash160Hex: string): string {
  return new (Address as any)(fromHex(hash160Hex)).Value as string
}

/**
 * Collapse a stored brc42KeyId into a compact ownership label. Self-owned
 * outputs carry a clean `recv N`; a peer-received (BRC-29) output stores the
 * full `brc29|prefix|suffix|senderIdentityKey` derivation — far too long for a
 * chip — so we show a short "received" badge with the full string on hover.
 */
function ownershipLabel(
  brc42KeyId: string | null
): { short: string; full: string; peer: boolean } | null {
  if (!brc42KeyId) return null
  if (brc42KeyId.startsWith('brc29|')) {
    const sender = brc42KeyId.split('|')[3] ?? ''
    return {
      short: 'received',
      full: `Peer-received (BRC-29)${sender ? ` · sender ${sender.slice(0, 16)}…` : ''}`,
      peer: true,
    }
  }
  return { short: brc42KeyId, full: `Self-owned · ${brc42KeyId}`, peer: false }
}

export default function AssetsPage() {
  const { wallet, stas } = useContext(WalletContext)

  const [holdings, setHoldings] = useState<OutputView[]>([])
  const [sentHoldings, setSentHoldings] = useState<OutputView[]>([])
  // Back-to-Genesis verdicts, keyed by `${txid}_${vout}`. Filled in the
  // background after holdings load; merged into the grouped view as they arrive.
  const [verifications, setVerifications] = useState<Map<string, OutpointVerification>>(new Map())
  const [activityExpanded, setActivityExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  // WOC has no bulk token endpoint, so a scan is one throttled request per
  // derived address — tens of seconds on a grown wallet. Show where it is.
  const [scanProgress, setScanProgress] = useState<string | null>(null)
  const [scanStats, setScanStats] = useState<
    | {
        rows: {
          label: string
          found: number
          registered: number
          known: number
          errors: number
          errorMessages: string[]
        }[]
        failed?: string
      }
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [receiveAddress, setReceiveAddress] = useState<string | null>(null)
  const [receiveLabel, setReceiveLabel] = useState<string | null>(null)
  const [generatingReceive, setGeneratingReceive] = useState(false)
  const [receiveCopied, setReceiveCopied] = useState(false)
  const [receiveError, setReceiveError] = useState<string | null>(null)
  /** Which protocol the next "Generate new address" derives under. */
  const [receiveProtocol, setReceiveProtocol] = useState<TokenProtocolId>('stas')

  const [sendTarget, setSendTarget] = useState<OutputView | null>(null)
  const [sendRecipient, setSendRecipient] = useState('')
  /**
   * Amount to send. Empty string = full UTXO. For STAS/DSTAS it's an integer
   * number of token satoshis (≤ source satoshis); for BSV-21 it's raw token
   * units (pre-decimals). A partial amount SPLITS: the recipient gets `amount`
   * and the remainder returns to the sender as token-change.
   */
  const [sendAmount, setSendAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null)

  // BSV-21 orphan recovery — pre-PR-32 sends produced change outputs
  // without basket+customInstructions+tags, so they don't show up in
  // the holdings list. This dialog lets a user re-internalize one by
  // outpoint after the fix shipped.
  const [recoverDialogOpen, setRecoverDialogOpen] = useState(false)
  const [recoverTxid, setRecoverTxid] = useState('')
  const [recoverVout, setRecoverVout] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [recoverResult, setRecoverResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Filter state — applied to groups by symbol, name, or tokenId.
  const [filter, setFilter] = useState('')

  const identityKey = stas?.keyDeriver?.identityKey
  const chain = stas?.keyDeriver?.chain

  // One verification service per chain — it owns the per-outpoint cache, so a
  // re-open of the page verifies only newly-arrived tokens. Reuses the
  // wallet-wide BackToGenesisClient when present (avoids a duplicate instance).
  const b2gClient = stas?.backToGenesis
  const verifier = useMemo(
    () =>
      new TokenVerificationService({
        chain: (chain as 'main' | 'test' | 'ttn') ?? 'main',
        client: b2gClient,
      }),
    [chain, b2gClient]
  )

  // Verify a set of holdings and fold each verdict into state. Fail-safe: the
  // service never throws, so a WOC hiccup just leaves those outpoints `unknown`.
  //
  // A settled verdict is FINAL: an outpoint's provenance can't change (a reorg
  // aside), so once we know it we never call the endpoint for it again — not on
  // the next load, not on Refresh. Only outpoints with no settled verdict yet
  // are verified. Pass `{ force: true }` to deliberately re-check (the badge's
  // click handler does this).
  //
  // Durable store is the wallet DB (`token_verifications`, migration 0004): we
  // seed from it so a re-opened wallet shows badges with zero network, and only
  // freshly obtained verdicts are written back.
  const verifyHoldings = useCallback(
    async (rows: OutputView[], opts: { force?: boolean } = {}) => {
      if (!identityKey || !chain) return
      const force = opts.force === true

      // 1. Seed from the DB — instant badges, and the record of what's already
      //    settled so we can skip it below.
      const settled = new Set<string>()
      try {
        const persisted: any[] = (await stasQuery(identityKey, chain, 'listTokenVerifications', [])) ?? []
        const byOutpoint = new Map(persisted.map((r) => [`${r.txid}_${r.vout}`, r]))
        const seed: Array<{ output: { txid: string; vout: number; protocol: TokenProtocolId }; verdict: OutpointVerification }> = []
        const seededState = new Map<string, OutpointVerification>()
        for (const o of rows) {
          const r = byOutpoint.get(`${o.txid}_${o.vout}`)
          if (!r) continue
          const verdict: OutpointVerification = {
            outpoint: `${o.txid}_${o.vout}`,
            result: r.result,
            reason: r.reason ?? undefined,
            genesis: r.genesis ?? undefined,
            genesisDepth: r.genesisDepth ?? undefined,
          }
          seed.push({ output: { txid: o.txid, vout: o.vout, protocol: o.protocol }, verdict })
          seededState.set(verdict.outpoint, verdict)
          settled.add(verdict.outpoint) // DB only ever holds settled verdicts
        }
        verifier.seed(seed)
        if (seededState.size) setVerifications((prev) => new Map([...prev, ...seededState]))
      } catch {
        /* DB seed is best-effort; verification below still runs from scratch */
      }

      // 2. Verify ONLY the outpoints without a settled verdict — from the DB
      //    above, or from a verdict reached earlier this session. Each verified
      //    result is persisted; already-settled ones are neither re-fetched nor
      //    re-written. `force` overrides the skip for an explicit re-check.
      for (const o of rows) {
        const op = `${o.txid}_${o.vout}`
        if (!force) {
          if (settled.has(op)) continue
          const cached = verifier.peek(o)
          if (cached && cached.result !== 'undetermined') continue
        }
        const v = await verifier.verifyOutput(o, { force })
        setVerifications((prev) => {
          const next = new Map(prev)
          next.set(v.outpoint, v)
          return next
        })
        if (v.result !== 'undetermined') {
          try {
            await stasQuery(identityKey, chain, 'upsertTokenVerification', [
              {
                txid: o.txid,
                vout: o.vout,
                protocol: o.protocol,
                result: v.result,
                genesis: v.genesis ?? null,
                genesisDepth: v.genesisDepth ?? null,
                reason: v.reason ?? null,
                verifiedAt: new Date().toISOString(),
              },
            ])
          } catch {
            /* persistence is best-effort; the badge already rendered from state */
          }
        }
      }
    },
    [verifier, identityKey, chain]
  )

  const loadHoldings = useCallback(async () => {
    if (!identityKey || !chain) return
    setLoading(true)
    setError(null)
    try {
      // Fetch both current (default) and the full set (includeSpent: true).
      // The full set lets us build the Activity feed alongside the live holdings.
      const [outputsRaw, allRaw, tokensRaw]: [any[], any[], any[]] = await Promise.all([
        stasQuery(identityKey, chain, 'listStasOutputs', []),
        stasQuery(identityKey, chain, 'listStasOutputs', [{ includeSpent: true }]),
        stasQuery(identityKey, chain, 'listStasTokens', []),
      ])
      const tokenMap: Record<string, any> = {}
      for (const t of tokensRaw ?? []) tokenMap[t.tokenId] = t

      const toView = (o: any): OutputView => {
        const sats = o.outputSatoshis ?? o.tokenSatoshis ?? 0
        return {
          outpoint: `${o.txid}.${o.vout}`,
          txid: o.txid,
          vout: o.vout,
          satoshis: sats,
          spendable: !!o.spendable,
          tokenId: o.tokenId ?? '',
          symbol: tokenMap[o.tokenId]?.symbol ?? o.symbol ?? null,
          name: tokenMap[o.tokenId]?.name ?? null,
          brc42KeyId: o.brc42KeyId ?? null,
          ownerFieldHash160: o.ownerFieldHash160,
          ownerAddress: hash160ToAddress(o.ownerFieldHash160),
          scriptHex: o.lockingScript ?? null,
          frozen: !!o.frozen,
          confiscated: !!o.confiscated,
          spentBy: o.spentBy ?? null,
          createdAt: o.createdAt ?? null,
          // Stamped by migration 0002; legacy rows default to 'stas'.
          protocol: (o.protocol as TokenProtocolId) ?? 'stas',
          // STAS/DSTAS: satoshisPerToken=1, so tokenAmount = satoshis.
          tokenAmount: String(sats),
          decimals: 0,
          icon: null,
        }
      }

      // STAS / DSTAS holdings.
      const stasHoldings = (outputsRaw ?? []).map(toView)

      // BSV-21 holdings — second data source. Goes through the BRC-100
      // listOutputs surface so tags (id/amt/dec/sym/icon) come back with
      // each row. The IPC basket query doesn't expose tags.
      let bsv21Holdings: OutputView[] = []
      if (wallet) {
        try {
          const res: any = await wallet.listOutputs({
            basket: BSV21_BASKET,
            includeTags: true,
            // includeCustomInstructions is load-bearing: bsv21RowToView reads
            // brc42KeyId / ownerAddress out of customInstructions, and the
            // Send button gate disables on `!brc42KeyId`. Without this flag
            // every BSV-21 row renders unsendable.
            includeCustomInstructions: true,
            include: 'locking scripts',
            limit: 10000,
          } as any)
          const rows: any[] = res?.outputs ?? []
          bsv21Holdings = rows.map(bsv21RowToView)
        } catch {
          /* BSV-21 holdings just won't surface if the basket is missing */
        }
      }

      const combined = [...stasHoldings, ...bsv21Holdings]
      setHoldings(combined)
      // Kick off Back-to-Genesis verification in the background — the card
      // badges fill in as verdicts arrive; holdings render immediately.
      void verifyHoldings(combined)

      // Sent = anything from the "all" set that has spentBy set (and isn't in
      // the current set). Newest first by createdAt (best proxy we have).
      const sent = (allRaw ?? [])
        .filter((o: any) => o?.spentBy)
        .map(toView)
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      setSentHoldings(sent)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [identityKey, chain, wallet, verifyHoldings])

  // Wraps loadHoldings with a real Bitails discovery scan first — picks up
  // STAS that arrived after the wallet's startup auto-scan. Without this the
  // page would only ever surface what's already in the local satellite, and
  // freshly received UTXOs stay invisible until the user manually scans from
  // the dev panel.
  const handleScan = useCallback(async () => {
    if (!stas?.discovery) {
      // No discovery service available — fall back to local refresh.
      await loadHoldings()
      return
    }
    setScanning(true)
    setScanStats(null)
    setScanProgress(null)
    const PHASE_LABEL: Record<string, string> = {
      stas: 'STAS',
      dstas: 'DSTAS',
      bsv21: 'BSV-21',
      register: 'registering',
    }
    const onProgress = (p: { phase: string; done: number; total: number }) =>
      setScanProgress(`${PHASE_LABEL[p.phase] ?? p.phase} ${p.done + 1}/${p.total}`)
    try {
      // Run STAS / DSTAS first (one merged WOC scan), then BSV-21. Sequential
      // so error attribution stays clear in the summary chips below.
      // A scan error carries the reason that made a candidate unusable. Keep it
      // — a bare count tells a tester nothing about what to report back.
      const describe = (errs?: { outpoint?: string; message: string }[]): string[] =>
        (errs ?? []).map((e) => (e.outpoint ? `${e.outpoint}: ${e.message}` : e.message))

      const stasRes = await stas.discovery.scan({ onProgress })
      const stasErrors = describe(stasRes.errors)
      if (stasErrors.length > 0) console.warn('[scan] STAS/DSTAS errors:', stasErrors)
      const rows = [
        {
          label: 'STAS / DSTAS',
          found: stasRes.candidates ?? 0,
          registered: stasRes.registered ?? 0,
          known: stasRes.skippedAlreadyKnown ?? 0,
          errors: stasErrors.length,
          errorMessages: stasErrors,
        },
      ]
      let failed: string | undefined
      if (stas.bsv21Discovery) {
        try {
          const bsv21Res = await stas.bsv21Discovery.scan({ onProgress })
          const bsv21Errors = describe(bsv21Res.errors)
          if (bsv21Errors.length > 0) console.warn('[scan] BSV-21 errors:', bsv21Errors)
          rows.push({
            label: 'BSV-21',
            found: bsv21Res.candidates ?? 0,
            registered: bsv21Res.registered ?? 0,
            known: bsv21Res.skippedAlreadyKnown ?? 0,
            errors: bsv21Errors.length,
            errorMessages: bsv21Errors,
          })
        } catch (e) {
          failed = `BSV-21 scan failed: ${e instanceof Error ? e.message : String(e)}`
        }
      }
      setScanStats({ rows, failed })
    } catch (e) {
      setScanStats({ rows: [], failed: `Scan failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setScanning(false)
      setScanProgress(null)
    }
    await loadHoldings()
  }, [stas?.discovery, stas?.bsv21Discovery, loadHoldings])

  useEffect(() => {
    if (!stas?.keyDeriver) return
    // First load: local-only (fast paint) plus a real scan in the background
    // so freshly arrived STAS show up without the user pressing anything.
    loadHoldings()
    handleScan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stas?.keyDeriver])

  const handleRecoverOrphan = useCallback(async () => {
    if (!stas?.bsv21Discovery || !identityKey || !chain) {
      setRecoverResult({ ok: false, message: 'discovery service or identity not ready' })
      return
    }
    const txid = recoverTxid.trim().toLowerCase()
    const voutNum = Number(recoverVout.trim())
    if (!/^[0-9a-f]{64}$/.test(txid)) {
      setRecoverResult({ ok: false, message: 'txid must be 64 hex chars' })
      return
    }
    if (!Number.isInteger(voutNum) || voutNum < 0) {
      setRecoverResult({ ok: false, message: 'vout must be a non-negative integer' })
      return
    }
    setRecovering(true)
    setRecoverResult(null)
    try {
      const res = await (stas.bsv21Discovery as any).recoverByOutpoint({
        txid,
        vout: voutNum,
        identityKey,
        chain,
      })
      if (res.ok) {
        if (res.alreadyHadBasket) {
          setRecoverResult({ ok: true, message: `Already recovered (outputId ${res.outputId}). No-op.` })
        } else {
          setRecoverResult({
            ok: true,
            message: `Recovered outputId ${res.outputId} (token ${res.tokenId?.slice(0, 12)}…, key recv ${res.keyIndex})`,
          })
        }
        await loadHoldings()
      } else {
        setRecoverResult({ ok: false, message: res.reason ?? 'recovery failed' })
      }
    } catch (e) {
      setRecoverResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setRecovering(false)
    }
  }, [stas?.bsv21Discovery, identityKey, chain, recoverTxid, recoverVout, loadHoldings])

  // Fold the latest B2G verdicts into each holding before grouping, so the
  // grouping can key on genesis and the cards can badge. Kept as a derivation
  // (not baked into `holdings`) so a verdict update re-groups without a reload.
  const verifiedHoldings = useMemo(
    () =>
      holdings.map((o) => {
        const v = verifications.get(`${o.txid}_${o.vout}`)
        return v ? { ...o, verification: v } : o
      }),
    [holdings, verifications]
  )

  const allGroups = useMemo(() => groupByToken(verifiedHoldings), [verifiedHoldings])

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return allGroups
    return allGroups.filter((g) => {
      if (g.symbol.toLowerCase().includes(needle)) return true
      if (g.name && g.name.toLowerCase().includes(needle)) return true
      for (const id of g.tokenIds) {
        if (id.toLowerCase().includes(needle)) return true
      }
      return false
    })
  }, [allGroups, filter])

  const totalSats = useMemo(() => holdings.reduce((s, o) => s + o.satoshis, 0), [holdings])

  const handleGenerateReceive = async () => {
    if (!stas) return
    setGeneratingReceive(true)
    setReceiveError(null)
    setReceiveCopied(false)
    try {
      // Dispatch to the protocol-specific deriver. BSV-21 lives in its own
      // BRC-42 keyspace so the receive-counter never collides with STAS.
      const deriver =
        receiveProtocol === 'bsv-21' ? stas.bsv21KeyDeriver : stas.keyDeriver
      if (!deriver) throw new Error(`no deriver for protocol ${receiveProtocol}`)
      const row = await deriver.createNextReceiveContext()
      setReceiveAddress(hash160ToAddress(row.ownerFieldHash160))
      setReceiveLabel(`${protocolLabel(receiveProtocol)} · ${row.keyId}`)
    } catch (e) {
      setReceiveError(e instanceof Error ? e.message : String(e))
    } finally {
      setGeneratingReceive(false)
    }
  }

  const handleCopyReceive = async () => {
    if (!receiveAddress) return
    try {
      await navigator.clipboard.writeText(receiveAddress)
      setReceiveCopied(true)
      setTimeout(() => setReceiveCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const openSend = (o: OutputView) => {
    setSendTarget(o)
    setSendRecipient('')
    // Pre-fill the amount with the full balance so the default is "send
    // everything" (editable down to split). STAS/DSTAS are satoshi-denominated;
    // BSV-21 uses raw token units.
    setSendAmount(o.protocol === 'bsv-21' ? o.tokenAmount : String(o.satoshis))
    setSendResult(null)
  }

  const handleSendConfirm = async () => {
    if (!sendTarget || !stas?.tokens || !sendTarget.scriptHex || !sendTarget.brc42KeyId) return
    const adapter = stas.tokens.getById(sendTarget.protocol)
    if (!adapter || !adapter.transferSupported || !adapter.transfer) {
      setSendResult({
        ok: false,
        message: `Send is not yet available for ${protocolLabel(sendTarget.protocol)} in this wallet.`,
      })
      return
    }
    setSending(true)
    setSendResult(null)
    try {
      // Build the cross-protocol args; per-protocol amount handling below.
      const baseArgs = {
        source: {
          txid: sendTarget.txid,
          vout: sendTarget.vout,
          scriptHex: sendTarget.scriptHex,
          satoshis: sendTarget.satoshis,
          brc42KeyId: sendTarget.brc42KeyId,
        },
        recipientAddress: sendRecipient.trim(),
      }
      let args: any = baseArgs
      let isPartial = false

      if (sendTarget.protocol === 'bsv-21') {
        // BSV-21 amount is a raw bigint string; validated here at the UI
        // boundary so the transfer service can trust its input.
        const raw = sendAmount.trim() || sendTarget.tokenAmount
        if (!/^\d+$/.test(raw)) {
          setSendResult({ ok: false, message: 'Amount must be a non-negative integer (raw token units).' })
          setSending(false)
          return
        }
        let sendAmtBig: bigint
        let sourceAmtBig: bigint
        try {
          sendAmtBig = BigInt(raw)
          sourceAmtBig = BigInt(sendTarget.tokenAmount)
        } catch {
          setSendResult({ ok: false, message: 'Could not parse amount as a bigint.' })
          setSending(false)
          return
        }
        if (sendAmtBig <= 0n) {
          setSendResult({ ok: false, message: 'Amount must be > 0.' })
          setSending(false)
          return
        }
        if (sendAmtBig > sourceAmtBig) {
          setSendResult({ ok: false, message: `Amount exceeds UTXO balance (${formatTokenAmount(sendTarget.tokenAmount, sendTarget.decimals)}).` })
          setSending(false)
          return
        }
        isPartial = sendAmtBig < sourceAmtBig
        // BSV21TransferService builds a token-change output when sendAmt < sourceAmt.
        const extras: Bsv21SendExtras = {
          tokenId: sendTarget.tokenId,
          sourceAmt: sendTarget.tokenAmount,
          amount: sendAmtBig.toString(),
          dec: sendTarget.decimals || undefined,
          sym: sendTarget.symbol ?? undefined,
          icon: sendTarget.icon ?? undefined,
        }
        args = { ...baseArgs, ...extras }
      } else {
        // STAS / DSTAS — satoshi-denominated. A blank amount (or the full
        // balance) sends the whole UTXO; a smaller amount SPLITS, and we derive
        // a self-owned change receive context so the remainder stays spendable
        // (mirrors the peer settlement adapter).
        const raw = sendAmount.trim()
        if (raw) {
          if (!/^\d+$/.test(raw)) {
            setSendResult({ ok: false, message: 'Amount must be a positive integer (token sats).' })
            setSending(false)
            return
          }
          const amt = Number(raw)
          if (amt <= 0 || amt > sendTarget.satoshis) {
            setSendResult({ ok: false, message: `Amount must be between 1 and ${sendTarget.satoshis.toLocaleString()} sats.` })
            setSending(false)
            return
          }
          if (amt < sendTarget.satoshis) {
            isPartial = true
            if (!stas.keyDeriver) {
              setSendResult({ ok: false, message: 'Key deriver unavailable — cannot build token-change for a partial send.' })
              setSending(false)
              return
            }
            const ctxRow = await stas.keyDeriver.createNextReceiveContext()
            args = {
              ...baseArgs,
              amount: amt,
              senderChangeHash160: ctxRow.ownerFieldHash160,
              senderChangeKeyId: ctxRow.keyId,
              tokenId: sendTarget.tokenId || undefined,
            }
          }
        }
      }

      const result = await adapter.transfer(args)
      if (result.ok) {
        setSendResult({
          ok: true,
          message: `Broadcast ✓ txid=${result.txid}${isPartial ? ' · change kept in your wallet' : ''}`,
        })
        // Both cases just reload from the DB — no scan needed. The transfer
        // service already spent the source and (on a partial send) registered
        // the token-change output before returning, so listStasOutputs /
        // the basket reflect the new balance immediately. The old scan-on-
        // partial was a leftover from before change-registration was synchronous.
        loadHoldings()
      } else {
        setSendResult({ ok: false, message: result.reason ?? 'transfer failed' })
      }
    } catch (e) {
      setSendResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(false)
    }
  }

  const toggleExpand = (key: string) => {
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!wallet) return null

  return (
    <Box sx={{ m: 2 }}>
      {/* Header */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent='space-between'
            alignItems={{ xs: 'stretch', md: 'flex-start' }}
            spacing={2}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant='h5' sx={{ fontWeight: 600 }}>
                Assets
              </Typography>
              <Typography variant='body2' color='text.secondary' sx={{ mt: 0.5 }}>
                Tokens held by this wallet — grouped by token, expandable to see each UTXO.
              </Typography>
              <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap sx={{ mt: 2 }}>
                <Chip
                  size='small'
                  icon={<TokenIcon />}
                  label={`${allGroups.length} ${allGroups.length === 1 ? 'token' : 'tokens'}`}
                />
                <Chip
                  size='small'
                  label={`${holdings.length} ${holdings.length === 1 ? 'output' : 'outputs'}`}
                  variant='outlined'
                />
                <Chip
                  size='small'
                  label={`${totalSats.toLocaleString()} sats`}
                  variant='outlined'
                  color='primary'
                />
              </Stack>
              <TextField
                size='small'
                placeholder='Filter by symbol, name, or tokenId…'
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                sx={{ mt: 2, width: '100%', maxWidth: 360 }}
                InputProps={{
                  startAdornment: <SearchIcon fontSize='small' sx={{ mr: 1, color: 'text.secondary' }} />,
                }}
              />
            </Box>
            <Stack spacing={1} alignItems={{ xs: 'stretch', md: 'flex-end' }} sx={{ flexShrink: 0 }}>
              <Stack direction='row' spacing={1} justifyContent='flex-end' flexWrap='wrap' useFlexGap>
                <Button
                  size='small'
                  variant='text'
                  onClick={() => {
                    setRecoverResult(null)
                    setRecoverDialogOpen(true)
                  }}
                  disabled={loading || scanning}
                >
                  Recover orphan
                </Button>
                <Button
                  size='small'
                  variant='contained'
                  startIcon={(loading || scanning) ? <CircularProgress size={14} color='inherit' /> : <RefreshIcon />}
                  onClick={handleScan}
                  disabled={loading || scanning}
                >
                  {scanning ? (scanProgress ? `Scanning ${scanProgress}` : 'Scanning…') : loading ? 'Loading…' : 'Refresh'}
                </Button>
              </Stack>
              {scanStats && (scanStats.rows.length > 0 || scanStats.failed) && (
                <Stack spacing={0.75} alignItems={{ xs: 'flex-start', md: 'flex-end' }} sx={{ maxWidth: 320 }}>
                  {scanStats.rows.map((r) => (
                    <Stack
                      key={r.label}
                      spacing={0.25}
                      alignItems={{ xs: 'flex-start', md: 'flex-end' }}
                      sx={{ width: '100%' }}
                    >
                      <Stack
                        direction='row'
                        spacing={0.5}
                        alignItems='center'
                        flexWrap='wrap'
                        useFlexGap
                        justifyContent={{ xs: 'flex-start', md: 'flex-end' }}
                      >
                        <Typography variant='caption' color='text.secondary' sx={{ fontWeight: 600, mr: 0.5 }}>
                          {r.label}
                        </Typography>
                        <Chip size='small' variant='outlined' label={`${r.found} found`} />
                        {r.registered > 0 && (
                          <Chip size='small' color='success' variant='outlined' label={`${r.registered} new`} />
                        )}
                        {r.known > 0 && <Chip size='small' variant='outlined' label={`${r.known} known`} />}
                        {r.errors > 0 && (
                          <Chip
                            size='small'
                            color='error'
                            variant='outlined'
                            label={`${r.errors} ${r.errors === 1 ? 'error' : 'errors'}`}
                          />
                        )}
                      </Stack>
                      {r.errorMessages.map((m) => (
                        <Typography
                          key={m}
                          variant='caption'
                          color='error'
                          sx={{
                            textAlign: { xs: 'left', md: 'right' },
                            wordBreak: 'break-word',
                            fontFamily: 'monospace',
                            fontSize: '0.68rem',
                          }}
                        >
                          {m}
                        </Typography>
                      ))}
                    </Stack>
                  ))}
                  {scanStats.failed && (
                    <Typography variant='caption' color='error' sx={{ textAlign: { xs: 'left', md: 'right' } }}>
                      {scanStats.failed}
                    </Typography>
                  )}
                </Stack>
              )}
            </Stack>
          </Stack>
          {error && (
            <Typography variant='caption' color='error' sx={{ display: 'block', mt: 1 }}>
              {error}
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Receive address */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent='space-between'
            alignItems={{ xs: 'stretch', sm: 'center' }}
            spacing={2}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant='h6' sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AddCircleOutlineIcon fontSize='small' /> Receive {receiveProtocol === 'stas' ? 'STAS / DSTAS' : protocolLabel(receiveProtocol)}
              </Typography>
              <Typography variant='caption' color='text.secondary'>
                Generates the next BRC-42 receive address for this standard. Share it with a sender.
              </Typography>
            </Box>
            <Stack
              direction='row'
              spacing={1}
              alignItems='center'
              flexWrap='wrap'
              useFlexGap
              justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}
            >
              {(['stas', 'bsv-21'] as TokenProtocolId[]).map((p) => (
                <Button
                  key={p}
                  size='small'
                  variant={receiveProtocol === p ? 'contained' : 'outlined'}
                  color={receiveProtocol === p ? 'primary' : 'inherit'}
                  onClick={() => setReceiveProtocol(p)}
                  disabled={generatingReceive}
                >
                  {p === 'stas' ? 'STAS / DSTAS' : protocolLabel(p)}
                </Button>
              ))}
              <Button
                size='small'
                variant='contained'
                startIcon={<AddCircleOutlineIcon fontSize='small' />}
                onClick={handleGenerateReceive}
                disabled={generatingReceive}
              >
                {generatingReceive ? 'Generating…' : 'New address'}
              </Button>
            </Stack>
          </Stack>
          {receiveError && (
            <Typography variant='caption' color='error' sx={{ display: 'block', mt: 1 }}>
              {receiveError}
            </Typography>
          )}
          {receiveAddress && (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              alignItems={{ xs: 'stretch', sm: 'center' }}
              sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}
            >
              <Box
                sx={{
                  p: 1,
                  bgcolor: 'background.paper',
                  borderRadius: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  alignSelf: { xs: 'center', sm: 'flex-start' },
                }}
              >
                <QRCodeSVG value={receiveAddress} size={140} includeMargin={false} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant='caption' color='text.secondary' display='block'>
                  {receiveLabel}
                </Typography>
                <Typography
                  variant='body1'
                  sx={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 600 }}
                >
                  {receiveAddress}
                </Typography>
                <Tooltip title={receiveCopied ? 'Copied!' : 'Copy address'}>
                  <Button
                    size='small'
                    startIcon={receiveCopied ? <CheckIcon /> : <ContentCopyIcon />}
                    onClick={handleCopyReceive}
                    sx={{ mt: 1 }}
                  >
                    {receiveCopied ? 'Copied' : 'Copy address'}
                  </Button>
                </Tooltip>
              </Box>
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* Token groups */}
      {groups.length === 0 && !loading && (
        <Card>
          <CardContent>
            <Typography variant='body2' color='text.secondary' textAlign='center'>
              No token holdings yet. Generate a receive address above and have a sender
              transfer STAS, DSTAS, or BSV-21 to it — then press <strong>Refresh</strong>.
            </Typography>
          </CardContent>
        </Card>
      )}

      {groups.map((g) => {
        const isExpanded = expanded.has(g.groupKey)
        return (
          <Card key={g.groupKey} sx={{ mb: 1.5 }}>
            <CardContent
              onClick={() => toggleExpand(g.groupKey)}
              sx={{
                cursor: 'pointer',
                py: 1.5,
                '&:last-child': { pb: 1.5 },
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Stack direction='row' alignItems='center' spacing={2}>
                <TokenIcon />
                <Box sx={{ flex: 1 }}>
                  <Typography variant='h6' sx={{ fontWeight: 600 }}>
                    {g.name || g.symbol}
                    {g.name && g.symbol !== g.name && (
                      <Typography
                        component='span'
                        variant='body2'
                        color='text.secondary'
                        sx={{ ml: 1, fontWeight: 400 }}
                      >
                        ({g.symbol})
                      </Typography>
                    )}
                  </Typography>
                  <Stack direction='row' spacing={1} sx={{ mt: 0.5 }} flexWrap='wrap' useFlexGap>
                    <Chip
                      size='small'
                      label={protocolLabel(g.protocol)}
                      color={g.protocol === 'stas' ? 'primary' : 'default'}
                      variant={g.protocol === 'stas' ? 'filled' : 'outlined'}
                    />
                    <TokenVerificationChip group={g} onReverify={() => verifyHoldings(g.outputs, { force: true })} />
                    <Chip
                      size='small'
                      label={
                        g.protocol === 'bsv-21'
                          ? `${formatTokenAmount(g.tokenAmount, g.decimals)} ${g.symbol}`
                          : `${g.totalSatoshis.toLocaleString()} sats`
                      }
                      variant='outlined'
                    />
                    <Chip
                      size='small'
                      label={`${g.outputCount} ${g.outputCount === 1 ? 'UTXO' : 'UTXOs'}`}
                      variant='outlined'
                    />
                    {g.protocol === 'bsv-21'
                      ? (g.spendableTokenAmount !== g.tokenAmount && (
                          <Chip
                            size='small'
                            label={`${formatTokenAmount(g.spendableTokenAmount, g.decimals)} spendable`}
                            variant='outlined'
                            color='warning'
                          />
                        ))
                      : (g.spendableSatoshis < g.totalSatoshis && (
                          <Chip
                            size='small'
                            label={`${g.spendableSatoshis.toLocaleString()} spendable`}
                            variant='outlined'
                            color='warning'
                          />
                        ))}
                    {g.tokenIds.size > 0 && (
                      <Tooltip title={Array.from(g.tokenIds).join(', ')}>
                        <Chip
                          size='small'
                          label={`id ${Array.from(g.tokenIds)[0].substring(0, 8)}…`}
                          variant='outlined'
                        />
                      </Tooltip>
                    )}
                  </Stack>
                </Box>
                <IconButton size='small'>
                  {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
              </Stack>
            </CardContent>

            <Collapse in={isExpanded} unmountOnExit>
              <Divider />
              <Box sx={{ p: 1 }}>
                {g.outputs.map((o) => {
                  const own = ownershipLabel(o.brc42KeyId)
                  const adapter = stas?.tokens?.getById(o.protocol)
                  const transferSupported = adapter?.transferSupported ?? false
                  const sendDisabled =
                    !o.spendable ||
                    o.frozen ||
                    o.confiscated ||
                    !o.scriptHex ||
                    !o.brc42KeyId ||
                    !transferSupported
                  const sendTip = !transferSupported
                    ? `Send is not yet available for ${protocolLabel(o.protocol)} in this wallet.`
                    : !o.spendable
                      ? 'This output is not spendable yet.'
                      : ''
                  const sendBtn = (
                    <Button
                      size='small'
                      variant='outlined'
                      startIcon={<SendIcon fontSize='small' />}
                      onClick={(e) => {
                        e.stopPropagation()
                        openSend(o)
                      }}
                      disabled={sendDisabled}
                    >
                      Send
                    </Button>
                  )
                  return (
                    <Stack
                      key={o.outpoint}
                      direction='row'
                      alignItems='center'
                      spacing={1.5}
                      sx={{ p: 1.5, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap' useFlexGap>
                          <Typography variant='body2' sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {o.protocol === 'bsv-21'
                              ? `${formatTokenAmount(o.tokenAmount, o.decimals)} ${o.symbol ?? ''}`
                              : `${o.satoshis.toLocaleString()} sats`}
                          </Typography>
                          {own && (
                            <Tooltip title={own.full}>
                              <Chip
                                size='small'
                                label={own.short}
                                variant='outlined'
                                color={own.peer ? 'info' : 'default'}
                              />
                            </Tooltip>
                          )}
                          {!o.spendable && (
                            <Chip size='small' label='not spendable' color='warning' variant='outlined' />
                          )}
                          {o.frozen && <Chip size='small' label='frozen' color='error' />}
                          {o.confiscated && <Chip size='small' label='confiscated' color='error' />}
                        </Stack>
                        <Typography
                          variant='caption'
                          color='text.secondary'
                          sx={{ fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}
                        >
                          <Box component='span' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {o.txid.substring(0, 16)}…:{o.vout}
                          </Box>
                          <a
                            href={`https://whatsonchain.com/tx/${o.txid}`}
                            target='_blank'
                            rel='noreferrer'
                            style={{ color: 'inherit', display: 'inline-flex' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <OpenInNewIcon sx={{ fontSize: 12 }} />
                          </a>
                        </Typography>
                        <Typography
                          variant='caption'
                          color='text.secondary'
                          sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          owner: {o.ownerAddress}
                        </Typography>
                      </Box>
                      <Box sx={{ flexShrink: 0 }}>
                        {sendTip ? (
                          <Tooltip title={sendTip}>
                            {/* span so MUI can attach the tooltip to a disabled button */}
                            <span>{sendBtn}</span>
                          </Tooltip>
                        ) : (
                          sendBtn
                        )}
                      </Box>
                    </Stack>
                  )
                })}
              </Box>
            </Collapse>
          </Card>
        )
      })}

      {/* Activity — sent STAS history (uses includeSpent:true on listStasOutputs) */}
      {sentHoldings.length > 0 && (
        <Card sx={{ mt: 2 }}>
          <CardContent
            onClick={() => setActivityExpanded((v) => !v)}
            sx={{
              cursor: 'pointer',
              py: 1.5,
              '&:last-child': { pb: 1.5 },
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Stack direction='row' alignItems='center' spacing={2}>
              <SendIcon fontSize='small' />
              <Box sx={{ flex: 1 }}>
                <Typography variant='subtitle1' sx={{ fontWeight: 600 }}>
                  Recent activity
                </Typography>
                <Typography variant='caption' color='text.secondary'>
                  {sentHoldings.length} STAS {sentHoldings.length === 1 ? 'transfer' : 'transfers'} sent from this wallet
                </Typography>
              </Box>
              <IconButton size='small'>
                {activityExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Stack>
          </CardContent>
          <Collapse in={activityExpanded} unmountOnExit>
            <Divider />
            <Box sx={{ p: 1 }}>
              {sentHoldings.map((o) => (
                <Stack
                  key={o.outpoint}
                  direction='row'
                  alignItems='center'
                  spacing={2}
                  sx={{
                    p: 1.5,
                    borderRadius: 1,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Chip
                    size='small'
                    label='SENT'
                    color='warning'
                    variant='outlined'
                    sx={{ minWidth: 64 }}
                  />
                  <Box sx={{ flex: 1 }}>
                    <Stack direction='row' spacing={1} alignItems='center'>
                      <Typography
                        variant='body2'
                        sx={{ fontFamily: 'monospace', fontWeight: 600 }}
                      >
                        {o.protocol === 'bsv-21'
                          ? `${formatTokenAmount(o.tokenAmount, o.decimals)} ${o.symbol ?? ''}`
                          : `${o.satoshis.toLocaleString()} sats`}
                      </Typography>
                      {o.protocol !== 'bsv-21' && o.symbol && (
                        <Chip size='small' label={o.symbol} variant='outlined' />
                      )}
                      {o.brc42KeyId && (
                        <Chip size='small' label={`from ${o.brc42KeyId}`} variant='outlined' />
                      )}
                    </Stack>
                    <Typography
                      variant='caption'
                      color='text.secondary'
                      sx={{ fontFamily: 'monospace', display: 'block' }}
                    >
                      <span>source </span>
                      <a
                        href={`https://whatsonchain.com/tx/${o.txid}`}
                        target='_blank'
                        rel='noreferrer'
                        style={{ color: 'inherit' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {o.txid.substring(0, 14)}…:{o.vout}
                      </a>
                    </Typography>
                    {o.spentBy && (
                      <Typography
                        variant='caption'
                        color='text.secondary'
                        sx={{ fontFamily: 'monospace', display: 'block' }}
                      >
                        <span>spent in </span>
                        <a
                          href={`https://whatsonchain.com/tx/${o.spentBy}`}
                          target='_blank'
                          rel='noreferrer'
                          style={{ color: 'inherit' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {o.spentBy.substring(0, 14)}…
                        </a>
                      </Typography>
                    )}
                    {o.createdAt && (
                      <Typography variant='caption' color='text.secondary' display='block'>
                        received {new Date(o.createdAt).toLocaleString()}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              ))}
            </Box>
          </Collapse>
        </Card>
      )}

      {/* Send dialog */}
      <Dialog
        open={!!sendTarget}
        onClose={() => {
          if (!sending) {
            setSendTarget(null)
            setSendResult(null)
          }
        }}
        fullWidth
        maxWidth='sm'
      >
        <DialogTitle>Send {sendTarget?.symbol ?? 'STAS'}</DialogTitle>
        <DialogContent>
          {sendTarget && (
            <Stack spacing={2}>
              {sendTarget.verification?.result === 'not-authentic' && (
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 1,
                    bgcolor: 'error.main',
                    color: 'error.contrastText',
                    display: 'flex',
                    gap: 1,
                    alignItems: 'flex-start',
                  }}
                >
                  <GppBadIcon fontSize='small' />
                  <Typography variant='caption'>
                    <strong>This token failed provenance verification.</strong> It does not
                    descend from a genuine mint
                    {sendTarget.verification.reason ? ` (${sendTarget.verification.reason})` : ''} —
                    it may be counterfeit. Forwarding it passes the problem to the recipient.
                  </Typography>
                </Box>
              )}
              {sendTarget.verification?.result === 'undetermined' && (
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 1,
                    bgcolor: 'warning.main',
                    color: 'warning.contrastText',
                    display: 'flex',
                    gap: 1,
                    alignItems: 'flex-start',
                  }}
                >
                  <VerifiedIcon fontSize='small' />
                  <Typography variant='caption'>
                    Provenance could not be verified yet (unknown, not proven fake). You can
                    still send, but the origin hasn't been confirmed to a genesis mint.
                  </Typography>
                </Box>
              )}
              <Box>
                <Typography variant='caption' color='text.secondary'>
                  Sending
                </Typography>
                <Typography variant='body1' sx={{ fontWeight: 600 }}>
                  {sendTarget.protocol === 'bsv-21'
                    ? `${formatTokenAmount(sendTarget.tokenAmount, sendTarget.decimals)} ${sendTarget.symbol ?? ''}`
                    : `${sendTarget.satoshis.toLocaleString()} sats · ${sendTarget.symbol ?? 'STAS'}`}
                </Typography>
                <Typography
                  variant='caption'
                  color='text.secondary'
                  sx={{ fontFamily: 'monospace', display: 'block' }}
                >
                  from {ownershipLabel(sendTarget.brc42KeyId)?.short ?? '—'} ({sendTarget.ownerAddress.substring(0, 14)}…)
                </Typography>
              </Box>
              <TextField
                label='Recipient address'
                value={sendRecipient}
                onChange={(e) => setSendRecipient(e.target.value)}
                fullWidth
                placeholder='1...'
                disabled={sending}
                autoFocus
              />
              {(() => {
                // Amount + split preview — for all three standards. STAS/DSTAS
                // are satoshi-denominated; BSV-21 uses raw token units.
                const isB21 = sendTarget.protocol === 'bsv-21'
                const maxStr = isB21 ? sendTarget.tokenAmount : String(sendTarget.satoshis)
                let helper: string = isB21
                  ? 'Raw token units (integer). Leave blank to send the whole UTXO.'
                  : 'Token satoshis (integer). Leave blank to send the whole UTXO.'
                if (sendAmount && /^\d+$/.test(sendAmount)) {
                  try {
                    const amt = BigInt(sendAmount)
                    const max = BigInt(maxStr)
                    const change = max > amt ? max - amt : 0n
                    if (isB21) {
                      helper = `≈ ${formatTokenAmount(sendAmount, sendTarget.decimals)} ${sendTarget.symbol ?? ''}` +
                        (change > 0n ? ` · change ${formatTokenAmount(change.toString(), sendTarget.decimals)} ${sendTarget.symbol ?? ''} stays in your wallet` : '')
                    } else {
                      helper = change > 0n
                        ? `${amt.toLocaleString()} sats sent · ${change.toLocaleString()} sats change stays in your wallet`
                        : `${amt.toLocaleString()} sats — whole UTXO`
                    }
                  } catch { /* keep default helper */ }
                }
                return (
                  <TextField
                    label={`Amount (${isB21 ? 'raw' : 'sats'}, max ${maxStr})`}
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    fullWidth
                    placeholder={maxStr}
                    disabled={sending}
                    helperText={helper}
                  />
                )
              })()}
              <Typography variant='caption' color='text.secondary'>
                The wallet covers BSV fee automatically. After broadcast, the recipient
                wallet picks up the UTXO via the indexer-driven scan on its next Refresh.
              </Typography>
              {sendResult && (
                <Typography
                  variant='body2'
                  color={sendResult.ok ? 'success.main' : 'error'}
                  sx={{ wordBreak: 'break-all' }}
                >
                  {sendResult.message}
                </Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setSendTarget(null)
              setSendResult(null)
            }}
            disabled={sending}
          >
            Close
          </Button>
          <Button
            variant='contained'
            onClick={handleSendConfirm}
            disabled={sending || !sendRecipient.trim() || sendResult?.ok}
          >
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={recoverDialogOpen}
        onClose={() => !recovering && setRecoverDialogOpen(false)}
        maxWidth='sm'
        fullWidth
      >
        <DialogTitle>Recover orphaned BSV-21 output</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant='body2' color='text.secondary'>
              Pre-fix BSV-21 sends produced change outputs that landed in the wallet's
              outputs table but were not assigned to the bsv-21-tokens basket, so they
              don't show up in your holdings. Enter the outpoint to reassign it
              retroactively. Idempotent — re-running on a recovered output is a no-op.
            </Typography>
            <TextField
              size='small'
              label='Transaction ID'
              placeholder='64 hex chars'
              value={recoverTxid}
              onChange={(e) => setRecoverTxid(e.target.value)}
              disabled={recovering}
              fullWidth
            />
            <TextField
              size='small'
              label='Vout'
              placeholder='non-negative integer'
              value={recoverVout}
              onChange={(e) => setRecoverVout(e.target.value)}
              disabled={recovering}
              fullWidth
            />
            {recoverResult && (
              <Typography
                variant='body2'
                color={recoverResult.ok ? 'success.main' : 'error'}
                sx={{ wordBreak: 'break-all' }}
              >
                {recoverResult.message}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setRecoverDialogOpen(false)
              setRecoverTxid('')
              setRecoverVout('')
              setRecoverResult(null)
            }}
            disabled={recovering}
          >
            Close
          </Button>
          <Button
            variant='contained'
            onClick={handleRecoverOrphan}
            disabled={recovering || !recoverTxid.trim() || !recoverVout.trim()}
          >
            {recovering ? 'Recovering…' : 'Recover'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
