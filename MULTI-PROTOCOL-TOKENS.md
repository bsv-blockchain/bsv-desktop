# Multi-protocol token support — what changed and why

> Handoff document for the `close-out` branch. Audience: a developer who already
> knows BSV Desktop's STAS-era architecture and needs to understand how it grew
> to support three token protocols at once.

## TL;DR

The wallet went from **STAS-only** to **STAS + DSTAS + BSV-21**. A new
`TokenProtocolAdapter` seam abstracts protocol-specific work (script parsing,
transfer building, basket routing); the existing STAS pipeline is now a
concrete adapter; DSTAS and BSV-21 are two more.

**Discovery reality (verified empirically 2026-05-28):** the three
protocols sit in three different states:

- **Classic STAS** — Bitails's STAS-aware indexer surfaces these
  (mempool + confirmed). `StasDiscoveryService.scan()` works.
- **DSTAS** — no public indexer. Bitails's STAS-aware matcher locks
  onto the classic `76a914…88ac69` wrap and skips the DSTAS template
  entirely. WoC's curated registry returns `utxos: null` for any
  self-broadcast token. Receives flow through `/stas/register-by-txid`.
- **BSV-21** — the 1Sat overlay DOES index BSV-21 outputs once the
  inscription is canonical AND deploys are auto-picked-up by JungleBus.
  But it has a three-gate validation chain (see §5 below) that our
  inscription builder previously failed. Once fixed:
  - **Deploys** index immediately via JungleBus → discovery topic
    (`tm_bsv21`). `/1sat/bsv21/{tokenId}` returns full metadata.
  - **Transfers** require the per-token topic-manager (`tm_{tokenId}`)
    to be active — which 1sat-stack gates on the issuer funding the
    `fee_address` (typically 1000 sats per output). Until the token is
    "active", transfers can't be ingested by the overlay. They still
    broadcast on-chain and the dex-shell's `/bsv-21/register-by-txid`
    fast-path surfaces them at the recipient's colocated wallet.

So all three protocols share the same architectural fallback —
`register-by-txid` — and BSV-21 additionally gets free deploy-discovery
via JungleBus once the inscription is canonical.

Three database migrations land in this PR. No breaking changes to the BRC-100
HTTP Apps API surface (`/stas/list`, `/stas/transfer`, etc.) — they remain
STAS-shaped. New parallel routes for BSV-21 exist as demo fast-paths only.

---

## What the wallet was before

Single-protocol STAS pipeline:

- One satellite table per concept (`stas_tokens`, `stas_outputs`,
  `stas_receive_contexts`).
- One basket (`stas-tokens`) for token UTXOs.
- One discovery service (`StasDiscoveryService`) that ran a per-address Bitails
  scan and registered matches.
- One transfer service (`StasTransferService`) that handled the stas-js engine
  flow (CreateContract + Issue, BRC-42 unlock, sighash + createSignature).
- One BRC-42 protocol-id (`'stas token ownership'`) for receive-key derivation.
- The renderer assumed every UTXO in `stas_outputs` was classic STAS even
  though `StasDiscoveryService` silently also handled DSTAS via
  `dstasParser.ts`. DSTAS-shaped outputs co-existed in the same basket with
  no schema awareness — they were identified by re-parsing the locking script.
- Transfer worked only for classic STAS. DSTAS UTXOs that the user happened
  to receive would fail at send-time with a generic *"Invalid STAS script"*.

That was fine for a single-protocol demo and not fine for the next two protocols.

---

## What this PR added

### 1. A protocol-adapter seam (`src/lib/services/tokens/`)

`TokenProtocolAdapter` is the cross-protocol contract:

```ts
interface TokenProtocolAdapter {
  id: 'stas' | 'dstas' | 'bsv-21'
  basketName: string
  displayName: string
  transferSupported: boolean
  parseOutput(scriptHex, ctx?): Promise<ParsedTokenOutput | null>
  transfer?(args): Promise<TransferResult>
}
```

Three concrete adapters:

- **`StasProtocolAdapter`** — wraps `parseClassicStasMetadata` +
  `findCreateContractTxid` + `StasTransferService.transfer`.
  `transferSupported: true`. Basket: `stas-tokens`.
- **`DstasProtocolAdapter`** — wraps `parseDstasLockingScript` from
  `dstasParser` + `DstasTransferService`. `transferSupported: true` —
  spending-type 1 (regular transfer) is supported, see `DstasTransferService`
  + `buildDstasUnlockingScript` which mirror the SDK's
  `input-builder.ts:91-178` byte-for-byte. Basket: `dstas-tokens`.
- **`BSV21ProtocolAdapter`** — wraps the inline inscription parser + a
  `BSV21TransferService` using standard `createAction`/`signAction`.
  `transferSupported: true`. Basket: `bsv-21-tokens`.

A `TokenProtocolRegistry` holds the three adapters. `find(scriptHex, ctx)` walks
them in registration order (STAS prefix sniff first — cheapest — then DSTAS SDK
reader, then BSV-21 ord-envelope match) and returns the first that recognises
the script. `getById(id)` is used by the send dialog to pick the right transfer
path for a given UTXO.

The registry is exposed on `stas.tokens` from `WalletService` so the renderer
can dispatch sends without knowing protocol internals.

### 2. Per-protocol baskets

`src/lib/constants/baskets.ts`:

```ts
export const STAS_BASKET   = 'stas-tokens'
export const DSTAS_BASKET  = 'dstas-tokens'
export const BSV21_BASKET  = 'bsv-21-tokens'
export const TOKEN_BASKETS = [STAS_BASKET, DSTAS_BASKET, BSV21_BASKET] as const
```

Discovery's spendable-flag backfill iterates `TOKEN_BASKETS` so each protocol's
basket gets the same `setOutputSpendable(true)` treatment STAS got historically
(wallet-toolbox marks non-stock-template outputs `spendable=false` by default;
all three of our protocols need the flag flipped post-internalize).

### 3. Database migrations (additive)

| Migration | What it does |
|---|---|
| `0001_create_stas_tables.ts` | Original — `stas_tokens`, `stas_outputs`, `stas_receive_contexts`. Unchanged. |
| `0002_add_protocol_column.ts` | Adds `protocol TEXT NOT NULL DEFAULT 'stas'` to `stas_outputs` and `stas_tokens`. Backfills any DSTAS-shaped row in `stas_outputs` to `protocol = 'dstas'`. Moves those rows' wallet-toolbox `outputs.basketId` to a new `dstas-tokens` basket. Wrapped in `knex.transaction`. |
| `0003_bsv21_receive_contexts.ts` | Creates `bsv21_receive_contexts` mirroring the STAS variant — `(profileIdentityKey, keyIndex, keyId, ownerHash160, derivedPublicKey, createdAt)` unique on `(profileIdentityKey, keyIndex)`. No `bsv21_tokens` / `bsv21_outputs` satellite — BSV-21 metadata (`id/amt/dec/sym/icon`) lives on wallet-toolbox basket tags by the 1sat-toolbox convention, so the satellite is receive-only. |

The DSTAS basket split (0002) is the only data-mutating migration. Forward-only;
running it on an empty wallet is a no-op other than the `ALTER TABLE` additions.

### 4. Discovery model — per-protocol coverage

Empirically verified 2026-05-28 by minting + sending each protocol's
tokens to wallet-derived addresses and observing what gets indexed:

```
   STAS    →   StasDiscoveryService.scan() via Bitails     +  /stas/register-by-txid
              ✓ mempool + confirmed coverage on `tokens/        (immediate UI feedback)
              unspent` per address

   DSTAS   →   *** no public indexer ***                       /stas/register-by-txid
              (Bitails's matcher locks onto classic STAS         (THIS is the only working
               P2PKH wrap; DSTAS template starts with a raw       receive path — same route
               20-byte push and falls outside the scan rule)     as STAS; registry dispatch
                                                                 picks the DSTAS adapter)

   BSV-21  →   JungleBus → 1Sat overlay's BSV-21 topic-mgr  +  /bsv-21/register-by-txid
              ✓ DEPLOYS auto-index (`/1sat/bsv21/{tokenId}`     (immediate UI feedback
               returns metadata) AS LONG AS the inscription      + transfer fallback)
               passes 3 validity gates (see §6).
              ✗ TRANSFERS only index for tokens whose per-
               token topic-manager is "active" — gated on the
               issuer funding `fee_address` (1sat-stack's
               commercial model). Until then, transfers
               broadcast successfully on-chain but don't
               surface at recipient addresses via /1sat/owner.
               register-by-txid covers this gap for the
               colocated demo path.
```

**The `register-by-txid` HTTP routes bind to 127.0.0.1, not a public
surface.** They're the universal fallback. STAS gets free indexing via
Bitails on top. BSV-21 gets free indexing for deploys via JungleBus on
top, plus optionally for transfers if the token is activated. DSTAS only
has the localhost path.

Why each gap exists:

- **STAS via Bitails** — works because Bitails recognises the classic
  P2PKH-wrapped STAS prefix.
- **DSTAS** — DSTAS outputs lead with a bare 20-byte push instead of
  the P2PKH wrap; they fall outside Bitails's scan rule. WoC's
  `stas-tokens-beta` endpoint is a curated registry (returns
  `utxos: null` for newly-minted tokens of either template). A
  dedicated DSTAS indexer (self-hosted overlay, Bitails matcher
  extension, or relay protocol) would close the gap; the wallet code
  is structured so adding one is mechanical — implement a
  `DstasDiscoveryService` mirroring the BSV21 one and wire it.
- **BSV-21 transfers** — the 1sat-stack pipeline has two topic-managers
  per BSV-21 token: `tm_bsv21` (discovery; admits deploys; auto-fed by
  JungleBus) and `tm_<tokenId>` (per-token; admits transfers; only
  spins up after fee activation). For demo / unfunded tokens, only
  deploys index; transfers wait on activation. The wallet's send-flow
  submits BEEF best-effort to `/1sat/bsv21/overlay/submit` (matching
  `@1sat/client`'s pattern) and logs a 500 warning when the per-token
  worker is absent — the broadcast still succeeds.

### 5. BSV-21 ord-inscription handling

Canonical on-chain output format (verified against indexed tokens like
`$NINJAPUNKGIRLS` and our own end-to-end test):

```
00 63                                           OP_FALSE OP_IF
03 6f7264                                       push "ord"
51                                              OP_1 (content-type tag — canonical
                                                       minimal push, NOT `01 01`)
12 6170706c69636174696f6e2f6273762d3230         push "application/bsv-20"
00                                              OP_0  (separator)
<pushdata> <json bytes>                         {"p":"bsv-20","op":"deploy+mint"|"transfer",
                                                 "id":"<txid>_<vout>",  ← UNDERSCORE (transfer only)
                                                 "amt":"<int>",         ← STRING bigint
                                                 "dec":"<n>",           ← STRING (not number)
                                                 "sym":"<sym>",…}
68                                              OP_ENDIF
76 a9 14 <20-byte pkh> 88 ac                    standard P2PKH owner script
```

Three byte/JSON-level validity gates the 1sat-stack
`go-templates/bsv21` decoder enforces (all three silently reject
violators — they return nil, no error message):

1. **Content-type tag must be OP_1 (0x51)**, the canonical minimal push.
   Non-minimal `01 01` (push 1 byte of value 0x01) is rejected.
2. **Every JSON value must be a string.** The decoder does
   `json.Unmarshal(content, &map[string]string{})` — a numeric `"dec":10`
   fails the unmarshal. Must be `"dec":"10"`.
3. **Transfer `id` field must be `<txid>_<vout>` (underscore).** Dot
   form (the convention used for outpoints elsewhere) is rejected. The
   wallet normalizes at the boundary in `BSV21TransferService` since
   some registration paths historically wrote the dot form into basket
   tags.

These gates apply to BOTH our direct overlay submit AND to JungleBus's
auto-pickup. Three regression tests in `test/tokens/bsv21-inscription.test.ts`
lock each gate in with byte-level assertions on the produced script.

Implementation (no SDK dependency for the envelope):

- `src/lib/services/tokens/bsv21/inscription.ts` — `buildBsv21Transfer` +
  `parseBsv21LockingScript`. Pure, ~200 LOC. Parser accepts both canonical
  and legacy forms so we don't break older outputs already in baskets.
- The trailing P2PKH means **wallet-toolbox can sign the input natively** via
  the standard sighash + the wallet's `createSignature` path. No engine, no
  custom unlock template, no `partialSTASUnlockingScript`-style trickery.
  Token id = `<txid>_<vout>` of the deploy+mint outpoint.

### 6. The 1Sat overlay coupling

The 1sat-stack architecture has two ingest paths and three topic-managers
that matter for our wallet:

```
                   ┌─── tm_bsv21 ─────────┐
                   │   (discovery topic)   │
   JungleBus  ────►│   admits deploys      ├──► /1sat/bsv21/{tokenId}
   subscriber      │   triggers per-token  │    /1sat/owner/{addr}/txos
                   │   worker creation     │
                   └───────────────────────┘
                              │
                              │ on deploy admission +
                              │ token activation (fee_address funded)
                              ▼
                   ┌─── tm_{tokenId} ─────┐
                   │   (per-token topic)   │
   POST            │   admits transfers    ├──► per-token balance,
   /1sat/bsv21/   ►│   validates ancestry  │    /1sat/bsv21/{tokenId}/
   overlay/submit  │                       │       p2pkh/{addr}/unspent
                   └───────────────────────┘
```

**For deploys (faucet path):** broadcast hits the chain → JungleBus
auto-picks-up → discovery topic admits → token metadata appears in
`/1sat/bsv21/{tokenId}`. Free, automatic, no submit needed — confirmed
empirically with our `1213` and `FB212` mints once the inscription was
canonical. The faucet's previous `POST /1sat/tx` step was redundant;
that endpoint is a broadcast pass-through (Arcade relay), not a
topic-manager ingest.

**For transfers (wallet path):** the wallet POSTs the signed
AtomicBEEF to `POST /1sat/bsv21/overlay/submit` with the `X-Topics:
tm_<tokenId>` header. Matches `@1sat/client@0.0.38`'s
`OverlayClient.submitBsv21` exactly. Returns 200 STEAK when the
per-token worker is up; returns 500 with a generic error when it
isn't (tokens that haven't been activated). The wallet logs and
proceeds — the tx is broadcast separately through wallet-toolbox's
ARC, so user value isn't blocked on overlay coupling.

**Public endpoints actually exposed on `api.1sat.app`:**
- `POST /1sat/bsv21/overlay/submit` — exists, returns 200 / 500
  depending on per-token worker availability. (`OPTIONS` returns 405
  Method Not Allowed; an earlier probe of `OPTIONS` misled us into
  thinking the endpoint didn't exist.)
- `POST /bsv21/overlay/submit` (no `/1sat/` prefix) — 404 publicly,
  but reachable via `wallet.1sat.app/bsv21/overlay/submit` with
  BRC-103 mutual auth. Not used by our wallet; documented for
  future reference.
- `POST /1sat/tx` — a public broadcast relay (returns
  `ACCEPTED_BY_NETWORK`). Doesn't feed the topic-manager. The
  wallet and the faucet used to hit this endpoint expecting
  indexing; that was wrong.

The faucet no longer submits to the overlay (relies on JungleBus).
The wallet submits during sends because it has the signed BEEF on
hand for free; the submit is best-effort with a console warning on
failure.

### 7. AssetsPage UI

- `OutputView` gained `protocol`, `tokenAmount`, `decimals`, `icon` fields.
- `groupByToken` keys on `(protocol, symbol, tokenId)` so a STAS and DSTAS that
  happen to share a symbol stay separate. Token-amount sums use bigints
  (`safeBigInt` defensively returns `0n` for malformed `amt` tag values).
- `formatTokenAmount(amt, dec)` renders raw bigint amounts with the right
  decimal precision; malformed amounts render as `? (<raw>)` rather than
  crashing the page.
- Group card carries a protocol-coloured chip ("STAS" filled / "DSTAS" outlined
  / "BSV-21" outlined).
- Per-UTXO Send button is gated on `adapter.transferSupported`. All three
  protocols now support transfer; the gate stays as a safety net for any
  future adapter that ships with `transferSupported: false`.
- Receive card has a STAS / BSV-21 protocol toggle; DSTAS uses STAS's BRC-42
  namespace (intentional — DSTAS receive piggybacks on the STAS deriver).

### 8. WalletService bundle

`stas.tokens` is the new registry. The existing fields stay:

```ts
stas: {
  keyDeriver: StasKeyDeriver
  ownership: StasOwnershipService
  discovery: StasDiscoveryService
  transfer: StasTransferService

  // New
  tokens:           TokenProtocolRegistry
  bsv21KeyDeriver:  BSV21KeyDeriver
  bsv21Discovery:   BSV21DiscoveryService
  bsv21Indexer:     OneSatIndexerClient
}
```

The `transfer` field is back-compat — it only handles classic STAS. New code
should route through `stas.tokens.getById(protocolId).transfer(...)`.

### 9. Apps API HTTP surface

| Route | Status |
|---|---|
| `GET /stas/list`, `POST /stas/receive-address`, `POST /stas/transfer`, `POST /stas/register-by-txid` | Unchanged; still STAS-shaped. |
| `POST /bsv-21/register-by-txid` | New — demo fast-path equivalent of the STAS one. Localhost only. |

No new public route surfaces. External apps continue to talk to the STAS Apps
API unchanged.

---

## Demo apps changes

### `demo/stas-faucet/`

Was a single-file Express server minting classic STAS via `stas-js`. Now a
multi-protocol faucet:

- Refactored `server.mjs` into thin wiring + three protocol modules in `lib/`
  (`mint-stas.mjs`, `mint-dstas.mjs`, `mint-bsv21.mjs`) sharing config,
  key material, and WoC helpers.
- Three POST endpoints: `/api/send-stas`, `/api/send-dstas`, `/api/send-bsv-21`.
  Same shared WIF funds all three; same `recentlyUsedOutpoints` tracker.
- `/api/info` now exposes a `protocols[]` catalog so the UI can drive itself
  off the server's declared capabilities.
- The standalone faucet UI (`public/index.html`) gains a Classic STAS / DSTAS /
  BSV-21 tab strip on the Mint card with protocol-specific input fields.
- DSTAS minting uses `dxs-bsv-token-sdk`'s `BuildDstasIssueTxs` — the SDK signs
  internally given a `PrivateKey`, so no manual unlocking-script construction.
- BSV-21 minting builds the ord-inscription envelope inline (same code as the
  wallet's parser), broadcasts via WhatsOnChain, **and** POSTs to
  `https://api.1sat.app/1sat/tx` to couple the mint with the overlay's BSV-21
  topic-manager. The 1Sat submit is best-effort; a failure logs but doesn't
  fail the mint (the tx is already on-chain).
- `amt` is now validated as `/^\d+$/` and rejected before broadcast — defends
  against the user typing Lorem-Ipsum into the Amount field.

### `demo/stas-dex-shell/`

Was a STAS-only Mint tab. Now:

- Protocol selector buttons (Classic STAS / DSTAS / BSV-21) above the existing
  mint form.
- Hidden / shown fields per protocol (BSV-21 reveals `amt` + `dec`; STAS/DSTAS
  show `symbol/name/satoshis`).
- After a successful mint, calls the matching wallet route:
  - STAS → `/stas/register-by-txid` (basket: `stas-tokens`)
  - DSTAS → `/stas/register-by-txid` (basket: `dstas-tokens` — same route,
    registry dispatch picks the DSTAS adapter based on template)
  - BSV-21 → `/bsv-21/register-by-txid`
- Result panel renders one txid for BSV-21 (deploy+mint is a single tx) or two
  for STAS/DSTAS (Contract + Issue).

---

## File index

New files:

```
src/lib/services/tokens/
  TokenProtocolAdapter.ts          interface + ParsedTokenOutput + TransferArgs/Result
  TokenProtocolRegistry.ts         singleton-ish holder + find()/getById()
  StasProtocolAdapter.ts
  DstasProtocolAdapter.ts
  BSV21ProtocolAdapter.ts
  bsv21/
    constants.ts                   BSV21_PROTOCOL_ID, ONESAT_API_DEFAULT_MAIN, etc.
    inscription.ts                 build/parse the ord envelope (no SDK dep)
    BSV21KeyDeriver.ts             BRC-42 receive keys under the bsv21 protocol id
    OneSatIndexerClient.ts         REST + SSE client for api.1sat.app
    BSV21Registration.ts           internalizeAction into bsv-21-tokens basket
    BSV21DiscoveryService.ts       scan() + registerByTxid()
    BSV21TransferService.ts        createAction + signAction + optional origin guard
  index.ts                         barrel exports

electron/stas-migrations/
  0002_add_protocol_column.ts
  0003_bsv21_receive_contexts.ts

demo/stas-faucet/lib/
  config.mjs                       extracted env + defaults
  wallet.mjs                       single-WIF key material
  woc.mjs                          UTXO listing + balance + broadcast
  mint-stas.mjs                    extracted from monolithic server.mjs
  mint-dstas.mjs                   new — BuildDstasIssueTxs wrapper
  mint-bsv21.mjs                   new — inscription builder (canonical OP_1
                                   content-type, string `dec`); relies on
                                   JungleBus auto-pickup for overlay indexing
```

Modified files (non-trivial):

```
src/lib/constants/baskets.ts                      DSTAS_BASKET, BSV21_BASKET, TOKEN_BASKETS
src/lib/services/WalletService.ts                 instantiates all three adapters + indexer
src/lib/services/stas/StasDiscoveryService.ts     dispatches through registry.find()
src/lib/services/stas/StasRegistration.ts         accepts {id, basketName} protocol
src/lib/pages/Dashboard/AssetsPage.tsx            protocol-aware grouping + decimal display
src/lib/WalletContext.tsx                         injects bsv21Discovery for the demo route
src/onWalletReady.ts                              /bsv-21/register-by-txid case
electron/stas-queries.ts                          protocol-aware writes + bsv21 receive CRUD
electron/stas-migrations/index.ts                 register 0002 + 0003

demo/stas-faucet/server.mjs                       slimmed to thin routing
demo/stas-faucet/public/index.html                protocol selector + protocol-specific fields
demo/stas-dex-shell/public/index.html             Mint tab protocol picker
demo/stas-dex-shell/public/app.js                 dispatch + per-protocol auto-register
demo/stas-dex-shell/public/styles.css             .mint-proto-row styling
```

---

## Status of the original "known limitations"

The first version of this doc listed five "limitations". A later review found three
of them were punts dressed up as constraints. All five have since been addressed:

| Item | Original state | Now |
|---|---|---|
| **F1 — Vite production build** | `npm run build:renderer` failed on the vendored SDK's `__exportStar` re-exports (Rollup's CJS static analyser couldn't trace them). | **Fixed.** `vite.config.ts` sets `build.commonjsOptions = { include: [/dxs-bsv-token-sdk/, /node_modules/], transformMixedEsModules: true }`. Build succeeds. |
| **F2 — Wallet transfers don't reach the overlay** | `BSV21TransferService` only broadcast through wallet-toolbox's default ARC. | **Fixed.** After `signAction` succeeds, the service passes `signResp.tx` (the signed AtomicBEEF) to `OneSatIndexerClient.submitTransaction(beef, { tokenId })`, which POSTs to the correct endpoint `https://api.1sat.app/1sat/bsv21/overlay/submit` with `X-Topics: tm_<tokenId>` — matching `@1sat/client@0.0.38`'s `OverlayClient.submitBsv21` exactly. Returns 200 STEAK for transfers of activated tokens; returns 500 (with console warning, non-blocking) for inactive tokens whose per-token topic-manager isn't running. Earlier this column wrongly claimed `/1sat/tx` was the canonical endpoint — it's a broadcast relay. Three inscription-validity gates also fixed (see §5). |
| **F3 — DSTAS send** | `transferSupported: false`. | **Fixed (separate PR).** `DstasTransferService` + `buildDstasUnlockingScript` mirror the SDK's `input-builder.ts:91-178` byte-for-byte. Signature flows through `wallet.createSignature` with BRC-42 (same namespace as STAS). `evaluateTransactionHex(...)` is run pre-broadcast as a diagnostic (not a hard gate — input 1 is the BSV funding which isn't signed yet at evaluator time). DstasProtocolAdapter is now `transferSupported: true`. |
| **F4 — BSV-21 partial-amount send** | UI sent the full UTXO only. | **Fixed.** Send dialog has an Amount field for BSV-21 with validation. |
| **F5 — No tests for new code** | True — only existing STAS tests ran. | **Addressed.** `test/tokens/bsv21-inscription.test.ts` (15 tests, including 3 byte-level regression tests for the inscription validity gates) + `test/tokens/dstas-transfer.test.ts` (6 tests). Other new modules (OneSatIndexerClient SSE, BSV21Registration, migrations) still rely on manual verification. |

## Outstanding work

- **DSTAS organic-receive indexer.** Bitails doesn't match the DSTAS
  template; receivers can't discover sent DSTAS via Refresh alone. The
  wallet's existing `/stas/register-by-txid` route (which dispatches
  through the protocol registry to the DSTAS adapter) is the working
  receive path. Closing the gap requires a dedicated DSTAS indexer.
- **BSV-21 transfer indexing for unactivated tokens.** Deploys index
  automatically via JungleBus → discovery topic. Transfers only index
  when the token's per-token topic-manager is active, which 1sat-stack
  gates on the issuer funding the `fee_address` (per-token commercial
  model). The wallet's submit logs a 500 warning and proceeds; the tx
  is already broadcast on-chain. For demo / unfunded tokens, the
  dex-shell's `/bsv-21/register-by-txid` fast-path covers colocated
  receives.

Neither gap blocks current wallet functionality for the demo /
local-development case.

Running the test suite:

```
npm run test:stas      # adapter refactor didn't regress STAS
npm run test:tokens    # BSV-21 inscription + DSTAS transfer
npm run build:renderer # prod build succeeds
```

---

## How to add a fourth protocol

If you wanted to add, say, BSV-20 v1 tickers:

1. **Adapter** — implement `TokenProtocolAdapter` in `src/lib/services/tokens/`.
   `parseOutput` recognises the script shape; `transfer` is optional. Pick a
   basket name and a `displayName`.
2. **Basket constant** — add `BSV20_BASKET = 'bsv-20-tokens'` to
   `constants/baskets.ts` and include it in `TOKEN_BASKETS`.
3. **Receive keys** — if the protocol uses a distinct BRC-42 protocol id, mirror
   `BSV21KeyDeriver` and add a `bsv20_receive_contexts` migration. If it
   reuses one of the existing namespaces, skip.
4. **Discovery** — if the protocol's outputs are indexed at owner addresses by
   the existing Bitails / 1Sat overlay scanners, plug the adapter into the
   `TokenProtocolRegistry` (in `WalletService._buildWallet`) and the existing
   scan loops will pick it up. If it needs its own indexer, mirror
   `BSV21DiscoveryService` + indexer client.
5. **WalletService** — instantiate the deriver / discovery / transfer / indexer
   in `_buildWallet`, register the adapter, expose any new services on the
   `stas` bundle.
6. **AssetsPage** — add the new protocol to the `protocolLabel` switch +
   chip-color logic. Add the per-protocol fields to the receive selector and
   the send dialog if relevant.
7. **Migration** — 0004_*.ts for any schema additions. Register in
   `stas-migrations/index.ts`.

The adapter seam means none of this requires touching `StasDiscoveryService`,
`StasTransferService`, the existing migrations, or the BRC-100 HTTP Apps API.

---

## Verification

Manual (no test suite). The day-of-merge smoke test:

1. Snapshot `~/.bsv-desktop/wallet-<identityKey>-main.db` before first launch.
2. `npm run dev` — confirm 0002 + 0003 apply without errors in the Electron
   log. Confirm any pre-existing DSTAS UTXO migrates from `stas-tokens` into
   `dstas-tokens` basket (SQL:
   `SELECT name, COUNT(*) FROM output_baskets b JOIN outputs o USING(basketId) WHERE name LIKE '%-tokens' GROUP BY name;`).
3. **STAS regression** — mint via the dex-shell with `Classic STAS`. Auto-registers
   into `stas-tokens`. Send one UTXO to a fresh address — should be byte-identical
   to pre-PR behavior.
4. **DSTAS mint + receive** — mint via the dex-shell with `DSTAS`. After mint,
   see *"auto-registered into your dstas-tokens basket (1 output)"* in the
   dex-shell result panel. The new row in Assets has an enabled Send button.
   (Refresh from an unrelated wallet, by contrast, will NOT discover this
   DSTAS — no public indexer covers the template.)
5. **DSTAS send** — pick the DSTAS UTXO, send to a fresh address. The
   pre-broadcast `evaluateTransactionHex` diagnostic runs (non-blocking) and
   the tx broadcasts via wallet-toolbox.
6. **BSV-21 mint + receive** — generate a BSV-21 receive address in the wallet
   (Receive card → BSV-21 toggle → Generate). Paste into the dex-shell's BSV-21
   Mint tab. After mint, see *"auto-registered into your bsv-21-tokens basket
   (1 output)"* in the dex-shell result panel. Refresh the wallet's Assets page
   — the same UTXO should be discovered organically by the overlay too (proves
   the indexer path works, not just the localhost shortcut).
7. **BSV-21 input validation** — submit the dex-shell mint with `amt = "lorem"`.
   Faucet returns 500 with *"Invalid BSV-21 amt — must be a non-negative integer
   string"* and broadcasts nothing.

---

## References

- yours-wallet (`@1sat/client`, `@1sat/actions`) — the production model we
  matched for BSV-21 indexer coupling: <https://github.com/yours-org/yours-wallet>
- 1sat-wallet-toolbox — the source-of-truth for the overlay's HTTP surface:
  <https://github.com/b-open-io/1sat-wallet-toolbox>
- 1Sat Stack OpenAPI spec — `GET https://api.1sat.app/1sat/docs` (rendered) or
  `GET https://api.1sat.app/api-spec/swagger.json` (raw)
- BSV-21 spec — <https://docs.1satordinals.com/fungible-tokens/bsv-21>
- DSTAS — uses `dxs-bsv-token-sdk`'s `BuildDstasIssueTxs` factory; SDK at
  `workspace/dxs-bsv-token-sdk/`
