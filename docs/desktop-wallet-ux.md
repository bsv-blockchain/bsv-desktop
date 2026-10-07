# Desktop wallet experience

The desktop UI follows BSV Wallet's payment and recovery model. Its main destinations are Wallet, Payments, Activity, Apps, and Settings. Assets and basket browsers are no longer navigation destinations; existing app-facing wallet and permission APIs remain available. Old Transfers and Legacy Bridge links open Payments.

## Payments

Payments has Send, Receive, and Nearby tabs. Send accepts a BSV address, wallet identity, or payment link. Identity payments and payment requests use Message Box, enabled by default at `https://messagebox.bsvblockchain.tech`. Missing or blank URLs use that default, including saved configurations; disabling Message Box is an explicit per-network setting. Receive offers wallet payment links and deterministic address receiving. Address receiving needs a WhatsOnChain-compatible API to find and verify deposits.

Nearby implements BSV Wallet's `bsvpay1` pairing request and encrypted version-5 payment frames with `@bsv/air-gap` QR fountains. Scan with a camera, import a QR image, or paste a code. Nearby transport is QR; BLE and Wi-Fi transport are not implemented. Transaction proof verification still needs network access. Mobile pairing requests do not identify their network, so the review asks both parties to check it; desktop requests include an optional chain field.

Signed identity tokens and nearby frames are saved before broadcast/delivery. Retries reuse the original payment, and nearby receiving preserves earlier pairing keys when a QR request is replaced. Saved payment delivery state is local to this installation and scoped to the wallet identity and network; moving a device's wallet database alone does not move its pending delivery codes.

## Recovery

New wallets start with a twelve-word BIP39 phrase. Imports accept valid 12, 15, 18, 21, or 24-word phrases without a BIP39 passphrase. The primary and privileged keys derive at `m/0'/0'` and `m/1'/0'`, matching BSV Wallet.

Two-of-three BRC-157 backup shares preserve the mobile entropy scheme: sixteen bytes of entropy followed by the first sixteen bytes of its SHA-256 checksum. Phrase export, share QR codes, share text exports, and phrase/share import are available under Settings → Back up & recover. Entropy share creation requires a twelve-word phrase. Other phrase lengths can still be imported and exported as phrases.

New setup no longer offers WAB or the older presentation-key/password model. Existing saved wallets retain their original derivation and unlock/recovery paths; opening them never silently changes their identity. Unreadable snapshots and mismatched recovery material show an error and preserve the saved data. Recovery phrases restore keys; use Wallet data files or storage backups to preserve wallet history and data too.

## Networks and services

Settings → BSV network, and the header's network button, switch between Mainnet, Testnet, TeraTestNet (TTN), and Tera Scaling (TSTN) during operation. Each network has separate local storage, history, service settings, and payment delivery state. Mainnet, Testnet, and TTN use defaults from the sibling BSV Wallet repository. TSTN requires Arcade and ChainTracks URLs; address receiving also needs its explorer API URL. Remote wallet storage is optional.

Network changes wait until payments, app HTTP calls, and permission decisions finish. The previous local monitor and storage connection are released before reopening the same identity on the selected network. Callback registration cannot start a competing wallet initialization during this transition. The persisted snapshot includes network service preferences; a failed change reports its underlying service error and attempts to restore the previous wallet. App requests remain unavailable when that recovery cannot safely complete.

## Mandala permissions

Mandala is enabled by default beside BTMS, including for installations with older BTMS-only preferences. The desktop port uses `@bsv/templates` 2.0's BRC-162 decoder, matches Mandala 0.4.1's actual unlock digest, and routes token-input-only actions through the same approval module. Approved transaction signatures are scoped to their app and expire after sixty seconds. Token-key encryption/HMAC calls are refused, app listings preserve requested custom instructions after access approval, and holding removal requires a fresh approval identifying the wallet's own output. The module's own admin listings omit custom instructions because its routing and holding lookup do not need them.

The earlier restriction on app listings was reverted to match BSV Wallet commit `b53214e6`: Mandala's issuer discovery and coin selection need the derivation bookkeeping, while token signing remains bound to approved transaction digests.

Live Testnet validation against `https://mandala-test.bsvblockchain.tech` discovered the issuer's existing asset after the listing approval and successfully issued 100 Desktop Mandala QA (DQA) tokens. The issuance transaction `fc2d4efeb18a5c645092cbed7efb634b5d0ae902efaaa4c7e335b425c46ce6fc` is confirmed in desktop activity. Issuance used one Mandala approval, with ordinary BSV fee authorization handled separately; no per-signature prompt appeared.

A subsequent attempt to send 25 DQA to the same wallet failed before `createAction`: Mandala 0.4.0's `prepareBlindedPayment` calls `rootSharedSecret(wallet, recipientKey)`, which calls `revealCounterpartyKeyLinkage` for the wallet's own identity. The SDK rejects this with `Counterparty secrets cannot be revealed for counterparty=self.`, including when the caller uses the explicit identity public key. Desktop preserves the SDK's root-secret restriction.

Desktop now depends on `@bsv/mandala` `^0.4.1`, locked to 0.4.1, and ports BSV Wallet commit `e85bf7d3` (toolbox 0.15.2). Mandala 0.4.1 keeps self-payment outputs in the token basket and marks their custom instructions with `direction: 'sent'`; the permission prompt counts those outputs as sent, with other basketed outputs counted as change. Missing or invalid instructions do not throw, and outputs outside the basket always count as sent. Regression tests cover partial-send amounts and full-balance self-sends with one approval and two real Mandala input signatures.

On October 7, 2026 the deployed console still served `assets/index-BKJVHD0G.js`, whose transfer pipeline unconditionally calls the blinding helper without the 0.4.1 self-send branch. Live partial- and full-balance self-send checks remain pending that console deployment.

## Validation

Regression coverage includes mobile mnemonic/share fixtures, address/link parsing, QR pairing/frame compatibility, saved-delivery retries, historical nearby pairing recovery, replay rejection, bounded balance/activity pagination, connected-app tracking, and network rollback/storage release. UI layouts were inspected with fixture data at desktop and compact widths in light and dark modes.

The production build passes. All 486 regression tests across 55 files pass under Electron's Node runtime, including 102 Mandala permission tests, native SQLite tests, and network switches using real wallet managers; the separate storage performance benchmark was excluded. The build still reports large dependency chunks and a vendor `eval` warning. Optional dashboard destinations load as separate chunks, while the existing wallet/extension dependencies remain in the core bundle.

Physical camera scanning, cross-device mobile QR exchange, and live funded payments require device testing. The Mandala checks above used Testnet tokens and Testnet transaction fees; no mainnet funds were moved during this redesign.
