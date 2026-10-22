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

Colored tokens (BRC-162 1Color outputs) are handled by the upstream BRC-207 wallet module `@bsv/color-permission-module` 0.2.0, registered with the permissions manager under the scheme id `color`. The module does all token logic. The desktop is only its host. Two issuer profiles are registered: the attested profile (`https://brc.dev/207/attested`) and the Mandala issuer profile from `@bsv/mandala` 0.5.0 (`createMandalaProfile`). Assets that require neither profile use a SHIP/lookup-resolver default provider (`ls_color_<assetId>`). On TSTN, which has no SHIP network, that provider fails closed: nothing is spendable, and every submit is refused.

**Mandala overlay setting.** Settings → BSV network (Network & services) has a Mandala overlay URL and the overlay operator's identity key for each network. Both are empty by default, and both must be set together. The key must be a valid compressed public key. Mandala assets are routed only to the overlay configured for the open network. With none configured, Mandala assets are refused (fail closed); the wallet never guesses an overlay.

**Consent and grants.** Every prompt shows the asset id, and shows amounts as exact decimals using the deploy's `dec` (up to 18 places, digit-exact at and beyond the uint64 edge). Issuer-supplied display metadata is untrusted. A malformed or unknown consent message is declined without a prompt.
- Approving `color_access` gives that app one 30-minute inventory **read** grant.
- Sends, signatures, relinquishments and offline receipts prompt every time. They never set or use the read grant.
- A request with `seekPermission: false` and no grant that covers it fails without a prompt: `Colored Tokens inventory read permission is required`, or `Colored Tokens spending permission is required`.
- The admin originator reads silently, but its spends still prompt.

**Holder-send linkage.** A Mandala holder send reveals the recipient output's linkage to the configured overlay, through the app's own wallet calls. With the encrypt / key-linkage-revelation prompts turned on in Settings, approving one `Mandala token sending` prompt lets that app make the `specific linkage revelation 2 p color …` calls toward a configured overlay key for 30 minutes. The `counterparty key linkage revelation <B>` call prompts once per (app, B) per 30 minutes. With the default settings these calls never prompt.

**Settlement.** The module's `settle()` runs 1 s after the wallet opens, every 5 minutes, and whenever the window comes back online. It runs one pass at a time and stops when the wallet closes or is rebuilt (network or profile switch, logout). A rebuild disposes the old module, its timers and its grants before the new one starts.

**Storage.** Module state (`color.v1.*` keys, including settlement evidence) lives in the main process under `~/.bsv-desktop/color-store/<identityKey>-<chain>/`. Each value is written atomically, so a crash mid-write keeps the previous value.

**Broadcast hold.** With local wallet storage, no transaction with a 1Color output, and no child of one this wallet holds, reaches ARC/Arcade before the overlay has admitted it. The main process and the monitor worker park such transactions in a journal under `~/.bsv-desktop/color-guard/<identityKey>-<chain>/`. The renderer releases a transaction only after `module.isSettled(txid)` reports it settled, and the release is retried after a crash. An offline receipt is credited when it is internalized, and shows as pending until the overlay admits it and it is released. Any guard fault holds the transaction.

**Local storage only.** The hold lives in the main-process storage. With remote wallet storage the storage server would create, internalize and broadcast the transaction itself, so nothing could be held. Colored Tokens therefore need local wallet storage:
- A wallet opened with remote primary storage registers a module that refuses every `p color` request with `ColorLocalStorageRequiredError` (`code: ERR_COLOR_LOCAL_STORAGE_REQUIRED`, `Colored Tokens need local wallet storage`). It advertises no `brc207-color` capability, and it starts no settlement and no linkage grant. The wallet still opens. Switching the primary back to local takes effect the next time the wallet is opened.
- A wallet opened with local storage checks, before every `p color` request and every settlement pass, that the local store is still the active one. Switching the primary to a remote store (Settings → Advanced) refuses requests from then on, without a rebuild. A request already past that check when the switch happens runs on the storage it started on.
- A remote **backup** keeps tokens enabled. A transaction the guard withheld waits at `sending` until main's re-park sweep moves it to `nosend`. A backup server's monitor would post a `sending` transaction it received by sync, so every backup sync (Sync now, adding a backup, switching the primary) runs that sweep first. The sweep runs on every held event as well, so the window is short. A withhold that lands during a sync, though, can still reach a backup at `sending`.

**Known limitations.**
- Only labelled `p color` requests are refused on remote storage. A transaction with a BRC-162 output that an app creates with no `p color` basket or label goes to the remote storage like any other, and is not held.
- Transactions held during an earlier local session stay held while remote storage is active. They are released once local storage is active again.
- Profile-free assets (the SHIP default provider) are released only when their SHIP host returns an **attested** admission. The vendored module 0.2.0 settles only from a STEAK entry with `admissionSignature` and `admissionIdentityKey`. Without those it reports `retry` (`ERR_NO_ATTESTATION`) and never marks the transaction settled. Such a transaction, and any child of it this wallet parked, stays held in `~/.bsv-desktop/color-guard/` indefinitely. Nothing in the UI shows this yet (gap CG-DESK-SETTLED, owned by the module).
- The guard classifies by script layout. Any output that starts `<push> <push> OP_2DROP` counts as BRC-162, even when it does not decode as a 1Color token. That includes, for example, a 2-field PushDrop with `lockPosition: 'after'`. Such a transaction, and every child of it, can only be released by `isSettled`, so this wallet never broadcasts it. Held txids are not shown in the UI yet; they are the `<txid>.held` files in the journal directory.

**HTTP bridge.** BRC-100 requests over the local HTTP bridge accept JSON bodies up to 50 MB, so large attested receipts in `customInstructions` and `signAction`'s `colorHandoff` pass unchanged. Errors leave the bridge as `{ message, name, code?, retryable?, transport? }`, and the body never includes `isError`. Clients match errors by `name`, or by the `[ClassName] ` message prefix. (The sdk's `HTTPWalletJSON` client still drops a 400 body without `isError`, so a typed name is lost there until the sdk changes.)

**No migration.** The old `p mandala` permission module is gone. Holdings in the `p mandala` basket, keys under `[2, 'p mandala token']`, and the old prompts are not migrated.

## Validation

Regression coverage includes mobile mnemonic/share fixtures, address/link parsing, face-to-face code parsing, saved-delivery retries, replay rejection, bounded balance/activity pagination, connected-app tracking, and network rollback/storage release. For 1Color it covers the read/spend grant split, the refusal on remote storage (at open and after a live primary switch) and the sweep before every backup sync, linkage grants limited to the overlay keys the module accepted, exact amounts at the uint64 edge, crash-safe and concurrent module-store writes, the settle scheduler and module disposal on rebuild, holder-send linkage grants, 16 MiB receipts and typed errors through the HTTP bridge, and the broadcast hold. UI layouts were inspected with fixture data at desktop and compact widths in light and dark modes.

The production build passes. `npm test` gives 66 passed and 4 skipped test files (885 tests passed, 1 expected failure, 25 skipped), and the WebRTC suite passes all 107 tests. The 4 skipped files need native SQLite built for Electron's ABI. Under Electron's Node runtime all 4 pass (14 tests): the storage-identity files, the broadcast-guard integration test (fake ARC sees nothing before release), and the two network-switch tests with real wallet managers, which now register the color module and check that a `p color` request reaches it on local storage after the first build and after the restart. The build still reports large dependency chunks and a vendor `eval` warning. Optional dashboard destinations load as separate chunks, while the existing wallet/extension dependencies remain in the core bundle.

Physical camera scanning, cross-device mobile QR exchange, and live funded payments require device testing. No mainnet funds were moved during this redesign. The 1Color module has not yet been checked live against a Mandala overlay.
