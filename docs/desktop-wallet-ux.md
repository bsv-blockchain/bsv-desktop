# Desktop wallet experience

The desktop UI follows BSV Wallet's payment and recovery model. Its main destinations are Wallet, Payments, Activity, Apps, and Settings. Assets and basket browsers are no longer navigation destinations; existing app-facing wallet and permission APIs remain available. Old Transfers and Legacy Bridge links open Payments.

## Payments

Payments has Send and Receive tabs. Send asks only for a recipient and an amount; the recipient is a person found by name, an identity key, a payment link, a BSV address, or a scanned code. Wallet identities are paid live over WebRTPay first, with Message Box as the fallback. Identity payments and payment requests use Message Box, enabled by default at `https://messagebox.bsvblockchain.tech`. Missing or blank URLs use that default, including saved configurations; disabling Message Box is an explicit per-network setting. Receive offers a wallet payment QR (always shown: a `peerpay:` link naming the identity key, the optional amount, and the message box when there is one) and deterministic address receiving. Live receiving is on by default. Address receiving needs a WhatsOnChain-compatible API to find and verify deposits.

There is no Nearby tab. The scanner reads the face-to-face codes other wallets show, BSV Wallet's `bsvpay1:` request and a WebRTPay `webrtpay1:` offer, as the payee's identity key, network and amount, and pays that identity live.

Signed identity tokens are saved before broadcast/delivery, and retries reuse the original payment. Saved payment delivery state is local to this installation and scoped to the wallet identity and network; moving a device's wallet database alone does not move its pending delivery codes.

## Recovery

New wallets start with a twelve-word BIP39 phrase. Imports accept valid 12, 15, 18, 21, or 24-word phrases without a BIP39 passphrase. The primary and privileged keys derive at `m/0'/0'` and `m/1'/0'`, matching BSV Wallet.

Two-of-three BRC-157 backup shares preserve the mobile entropy scheme: sixteen bytes of entropy followed by the first sixteen bytes of its SHA-256 checksum. Phrase export, share QR codes, share text exports, and phrase/share import are available under Settings → Back up & recover. Entropy share creation requires a twelve-word phrase. Other phrase lengths can still be imported and exported as phrases.

New setup no longer offers WAB or the older presentation-key/password model. Existing saved wallets retain their original derivation and unlock/recovery paths; opening them never silently changes their identity. Unreadable snapshots and mismatched recovery material show an error and preserve the saved data. Recovery phrases restore keys; use Wallet data files or storage backups to preserve wallet history and data too.

## Networks and services

Settings → BSV network, and the header's network button, switch between Mainnet, Testnet, TeraTestNet (TTN), and Tera Scaling (TSTN) during operation. Each network has separate local storage, history, service settings, and payment delivery state. Mainnet, Testnet, and TTN use defaults from the sibling BSV Wallet repository. TSTN requires Arcade and ChainTracks URLs; address receiving also needs its explorer API URL. Remote wallet storage is optional.

Network changes wait until payments, app HTTP calls, and permission decisions finish. The previous local monitor and storage connection are released before reopening the same identity on the selected network. Callback registration cannot start a competing wallet initialization during this transition. The persisted snapshot includes network service preferences; a failed change reports its underlying service error and attempts to restore the previous wallet. App requests remain unavailable when that recovery cannot safely complete.

## 1Color tokens (BRC-207)

Colored tokens (BRC-162 1Color outputs) are handled by the upstream BRC-207 wallet module `@bsv/color-permission-module` 0.2.0, registered with the permissions manager under the scheme id `color`. The module does all token logic. One required profile is registered: the Mandala issuer-v1 profile from `@bsv/mandala` 0.5.0 (`createMandalaProfile({ overlays, ledger })`). There is no attested profile, and receipts are plain BRC-207 custody JSON (design §9 B7). Assets that require no profile use a SHIP/lookup-resolver default provider (`ls_color_<assetId>`). On TSTN, which has no SHIP network, that provider fails closed: nothing is spendable, and every submit is refused.

**Mandala overlay setting.** Settings → BSV network (Network & services) has a Mandala overlay URL and the overlay operator's identity key for each network. Both are empty by default, and both must be set together. The key must be a valid compressed public key. Mandala assets are routed only to the overlay configured for the open network. With none configured, Mandala assets are refused (fail closed); the wallet never guesses an overlay.

**Consent and grants.** Every prompt shows the asset id, and shows amounts as exact decimals using the deploy's `dec` (up to 18 places, digit-exact at and beyond the uint64 edge). Issuer-supplied display metadata is untrusted. A malformed or unknown consent message is declined without a prompt.
- Approving `color_access` gives that app one 30-minute inventory **read** grant.
- Sends, signatures and relinquishments prompt every time. They never set or use the read grant. There is no offline-receive prompt: Mandala hand-overs are received by the desktop itself (below).
- A request with `seekPermission: false` and no grant that covers it fails without a prompt: `Colored Tokens inventory read permission is required`, or `Colored Tokens spending permission is required`.
- The admin originator reads silently, but its spends still prompt.

**Holder-send linkage.** A Mandala holder send reveals the recipient output's linkage to the configured overlay, through the app's own wallet calls. With the encrypt / key-linkage-revelation prompts turned on in Settings, approving one `Mandala token sending` prompt lets that app make the `specific linkage revelation 2 p color …` calls toward a configured overlay key for 30 minutes. The `counterparty key linkage revelation <B>` call prompts once per (app, B) per 30 minutes. With the default settings these calls never prompt.

**Mandala hand-overs (host runtime).** The desktop receives Mandala hand-overs itself: v4 bodies on MessageBox `mandala-color`, through `receiveHandovers` with the host ledger. Online, the chain is submitted to the configured overlay and the σ by its key is verified (`settled`); offline, COVER with the hop checks credits it as pending (`color_offline`). The receipt is then internalized through the permissions manager as the admin originator, so the module's issuer-v1 handler admits exactly what the ledger records. `settleReceipts` later submits pending records and calls the module's host-only `markSettled(txid)`. The ledger and `markSettled` are in-process only; no app can reach them over BRC-100. The `@bsv/mandala` lib is single-overlay, so with more than one Mandala overlay configured the runtime uses the first. The desktop has no token send screen, so it never signs a hand-over and offers holder sends to no app.

**Settlement.** One runtime tick (receive, then `settleReceipts`, then the broadcast release) runs 1 s after the wallet opens, every 5 minutes, whenever the window comes back online, and when main holds a broadcast. It runs one pass at a time and stops when the wallet closes or is rebuilt (network or profile switch, logout). A rebuild disposes the old module, its timers and its grants, and points the lib's journals away from the closed wallet, before the new one starts.

**Storage.** Module state (`color.v1.*` keys, including the `markSettled` records) lives in the main process under `~/.bsv-desktop/color-store/<identityKey>-<chain>/`. The host ledger and the `@bsv/mandala` journals (`mandala.*` keys) live in a separate store under `~/.bsv-desktop/mandala-store/<identityKey>-<chain>/`, reached only over the renderer's `mandala-store:*` IPC. Each value is written atomically, so a crash mid-write keeps the previous value.

**Broadcast hold.** With local wallet storage, no transaction with a 1Color output, and no child of one this wallet holds, reaches ARC/Arcade before the overlay has admitted it. The main process and the monitor worker park such transactions in a journal under `~/.bsv-desktop/color-guard/<identityKey>-<chain>/`. The renderer releases a transaction only once the host ledger records it `settled` (a σ by the overlay key this host verified), and the release is retried after a crash. An offline receipt is credited when it is internalized, and shows as pending until the overlay admits it and it is released. Any guard fault holds the transaction.

**Local storage only.** The hold lives in the main-process storage. With remote wallet storage the storage server would create, internalize and broadcast the transaction itself, so nothing could be held. Colored Tokens therefore need local wallet storage:
- A wallet opened with remote primary storage registers a module that refuses every `p color` request with `ColorLocalStorageRequiredError` (`code: ERR_COLOR_LOCAL_STORAGE_REQUIRED`, `Colored Tokens need local wallet storage`). It advertises no `brc207-color` capability, and it starts no settlement and no linkage grant. The wallet still opens. Switching the primary back to local takes effect the next time the wallet is opened.
- A wallet opened with local storage checks, before every `p color` request and every settlement pass, that the local store is still the active one. Switching the primary to a remote store (Settings → Advanced) refuses requests from then on, without a rebuild. A request already past that check when the switch happens runs on the storage it started on.
- A remote **backup** keeps tokens enabled. A transaction the guard withheld waits at `sending` until main's re-park sweep moves it to `nosend`. A backup server's monitor would post a `sending` transaction it received by sync, so every backup sync (Sync now, adding a backup, switching the primary) runs that sweep first. The sweep runs on every held event as well, so the window is short. A withhold that lands during a sync, though, can still reach a backup at `sending`.

**Known limitations.**
- Only labelled `p color` requests are refused on remote storage. A transaction with a BRC-162 output that an app creates with no `p color` basket or label goes to the remote storage like any other, and is not held.
- Transactions held during an earlier local session stay held while remote storage is active. They are released once local storage is active again.
- Profile-free assets (the SHIP default provider) have no host-ledger record, so a transaction of one, and any child of it this wallet parked, stays held in `~/.bsv-desktop/color-guard/` indefinitely. Nothing in the UI shows this yet (gap CG-DESK-SETTLED).
- The guard classifies by script layout. Any output that starts `<push> <push> OP_2DROP` counts as BRC-162, even when it does not decode as a 1Color token. That includes, for example, a 2-field PushDrop with `lockPosition: 'after'`. Such a transaction, and every child of it, can only be released by a host-ledger record, so this wallet never broadcasts it. Held txids are not shown in the UI yet; they are the `<txid>.held` files in the journal directory.

**HTTP bridge.** BRC-100 requests over the local HTTP bridge accept JSON bodies up to 50 MB, although BRC-207 receipts are now at most 1000 bytes. Errors leave the bridge as `{ message, name, code?, retryable?, transport? }`, and the body never includes `isError`. Clients match errors by `name`, or by the `[ClassName] ` message prefix. (The sdk's `HTTPWalletJSON` client still drops a 400 body without `isError`, so a typed name is lost there until the sdk changes.)

**No migration.** The old `p mandala` permission module is gone. Holdings in the `p mandala` basket, keys under `[2, 'p mandala token']`, and the old prompts are not migrated.

## Sigma proofs (BRC-230)

Sigma proofs are handled by the BRC-230 wallet module `@bsv/sigma-permission-module` 0.1.0, registered with the permissions manager under the scheme id `sigma` and enabled by default. The module makes zero-knowledge proofs with a key the wallet holds; the key itself never leaves the wallet. Apps reach it through `encrypt` calls under `p sigma <operation> <purpose>` protocol names, where the purpose and the key ID are chosen by the app.

**What an app can ask for.**
- A public key (`key`).
- A key under a base point the app chooses (`key` with a base).
- A proof of knowledge of one key (`schnorr`), a proof that the same key stands under two bases (`dleq`), or a proof of knowledge of one key in a group of keys (`or`).

**Consent.** At security levels 1 and 2 every request either prompts or is covered by a remembered approval. There are three prompts:
- **Public key request**, for a plain public key. Approving it is remembered for 30 minutes for that app, security level and purpose; the wallet does not ask again for public keys for them in that time. The prompt says: "Your wallet will not ask again for public keys for this app and purpose for 30 minutes."
- **Derived key request**, for a key under a base point the app chose. Approving it covers that one request.
- **Proof request**, for a `schnorr`, `dleq` or `or` proof. Approving it covers that one proof. The prompt says that a proof can release coins locked to that key, and that the wallet cannot see what the proof will be used for. There is no option to allow proofs for a period of time.

Each prompt shows the app's name in a chip at the top, then the purpose and the key ID. A proof request also names the kind of proof. A proof request shows a short fingerprint of its context and one of the whole request; a derived key request shows a short fingerprint of the whole request. Requests identical in every respect that arrive while one is waiting for an answer share that answer. A request with `seekPermission: false` that no remembered approval covers fails without a prompt.

**One request at a time.** Sigma prompts are shown in arrival order, one at a time. Approve is disabled for 600 ms after a prompt appears and for 600 ms after any decision in a 1Color or sigma prompt; the wallet's ordinary permission dialogs are not part of this. The dialog is redrawn for each request and focus returns to Deny, so holding Enter on Approve denies the next request. A decision applies only to the request it was shown for. Closing the dialog, or pressing Escape, denies the request. The 1Color and sigma prompts are built on the same prompt queue, focus handling and theme.

**Security level 0.** Level-0 requests are not prompted, as BRC-230 allows. Any app can obtain a level-0 key or proof, for any purpose, without the user being asked. Keys that guard value should use security level 1 or 2.

**Closing and switching.** A request whose prompt is still open when the wallet closes, or is rebuilt for a network or profile switch, is refused, even if it is approved afterwards.

**Application-chosen text.** The purpose, the key ID and the app's name are chosen by the requesting app. Before they are shown (the app's name in the chip at the top of the prompt, the others in the rows), control characters, format characters (such as bidirectional and zero-width characters), line and paragraph separators, and the double quotation marks U+201C to U+201F are replaced with U+FFFD, long runs of combining marks are shortened, and values longer than 120 characters are cut with a trailing `…`. The purpose and the key ID are shown in quotes in a monospace face, apart from the wallet's own words.

**Not supported in this version.**
- Privileged requests are refused without a prompt.
- Requests for a counterparty other than `self` are not supported in this version. They are refused without a prompt, at every security level.

**Key derivation for permission modules.** A permission module can declare `needsKeyDeriver`. Such a module, and no other, receives a view with one function, `derivePrivateKey`, that derives keys only under the module's own protocol namespace (names beginning `p <id> `), only for the counterparty `self`, and only until the wallet is rebuilt or closed. A module whose id is not lowercase letters and digits receives none. Permission modules are host-bundled, trusted code that runs in the wallet's own JavaScript realm. The view limits what a well-behaved module can ask for and guards against mistakes; it is not a sandbox. A permission module continues to receive the wallet object itself, as before this change: the view is least authority for this one new argument and is not a containment boundary. The sigma module is the only one that sets the flag.

## Validation

Regression coverage includes mobile mnemonic/share fixtures, address/link parsing, face-to-face code parsing, saved-delivery retries, replay rejection, bounded balance/activity pagination, connected-app tracking, and network rollback/storage release. For 1Color it covers the read/spend grant split, the refusal on remote storage (at open and after a live primary switch) and the sweep before every backup sync, linkage grants limited to the overlay keys the module accepted, exact amounts at the uint64 edge, crash-safe and concurrent module-store writes, the settle scheduler and module disposal on rebuild, holder-send linkage grants, typed errors through the HTTP bridge, the Mandala host store and ledger persistence, the host runtime (receive, settle → `markSettled`, single flight), and the broadcast hold. For sigma it covers the prompt message round trip, the consent view, the prompt queue and arming, focus hand-back, key deriver scoping and revocation, and the module's wiring through the permissions manager. UI layouts were inspected with fixture data at desktop and compact widths in light and dark modes.

The production build passes. With `better-sqlite3` rebuilt for Node (`npm rebuild better-sqlite3`, as CI does), `npm test` gives 79 passed test files (1116 tests passed, 1 expected failure), the WebRTC suite passes all 107 tests, and `npm run test:wallet-files` passes 5 files (28 tests). With native SQLite built for Electron's ABI instead, 4 files are skipped under plain Node; under Electron's Node runtime all 4 pass: the storage-identity files, the broadcast-guard integration test (fake ARC sees nothing before release), and the two network-switch tests with real wallet managers, which now register the color module and check that a `p color` request reaches it on local storage after the first build and after the restart. The build still reports large dependency chunks and a vendor `eval` warning. Optional dashboard destinations load as separate chunks, while the existing wallet/extension dependencies remain in the core bundle.

Physical camera scanning, cross-device mobile QR exchange, and live funded payments require device testing. No mainnet funds were moved during this redesign. The 1Color module has not yet been checked live against a Mandala overlay.
