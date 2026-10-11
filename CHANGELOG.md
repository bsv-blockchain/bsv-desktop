# Changelog

## Unreleased

### Features

- The wallet homepage has a "Need help?" card. Troubleshoot checks the wallet and fixes what it can by itself: network, app connections (re-connects the bridge, re-runs certificate trust when needed), failed transactions, coins already spent on-chain, message box anointing, and waiting incoming payments. It only asks the user for things it cannot do: back up, add funds, check the internet. Tour is a spotlight walkthrough of the wallet that explains apps are used in the normal web browser and approved here; it starts by itself once per profile the first time the wallet loads with a 0 sat balance.

### Bug Fixes

- Export wallet data no longer fails with "Check: timestamp" for wallets whose database stores dates as SQLite timestamps or epoch milliseconds; dates are normalised to ISO in the export.
- "Anoint Host" (Settings → Message Box, and the Payments page prompt) now advertises the host. Since `@bsv/message-box-client` 2.x, `init()` no longer anoints; the button only called `init()`, so no transaction was created and the host stayed "Not Anointed". It now calls `anointHost()`.
- Add an `allowScripts` policy for `better-sqlite3`, `electron`, `electron-winstaller` and `esbuild`. npm 12 skips dependency install scripts that are not listed, so a clean install had no Electron binary ("Electron failed to install correctly").
- Declare `@bsv/air-gap`, `jsqr` and `@bsv/templates` in `package.json`. They have been imported since the 3.0 overhaul but were only present as extraneous installs, so a clean `npm ci` failed to typecheck or build.
- Resolve npm audit findings (60 → 15, no critical). `vitest` 5; `axios` 1.x for `stas-js`; `elliptic` 6.6.1 and `bn.js` 4.12.5 for `bsv`; `qs` 6.16; `@electron/get` 5 for electron-builder. `stas-js` declares test tooling (`jest-allure`, `jest-html-reporter`, `chai`, `chai-as-promised`, `node-fetch`, `test`) as runtime dependencies but never loads them; they are replaced with an empty package. Remaining findings have no fix or are not reachable: `node-forge` (RSA signature verification, which the app does not use), `@bsv/identity-react` → `@types/jest` → `braces` (types only; the fix is identity-react 2.0, which needs `@bsv/sdk` 3), and `elliptic` GHSA-848j (no fixed version).
- App requests over the HTTP bridge (ports 3321/2121) no longer hang forever after unlock. The bridge was connected once, when the permissions manager appeared, which is before backend services finish starting; that attempt failed and was never retried, so the renderer never registered its HTTP listener. It now connects when the wallet is ready.
- The "SSL Certificate Trust" prompt no longer appears on every launch on macOS. Every generated certificate used serial 01 with the same issuer, and the keychain identifies certificates by issuer + serial, so a regenerated certificate was never stored even though its trust setting was. Chromium could not find it and rejected the HTTPS bridge. Certificates now get a random serial, and a certificate with the old fixed serial is replaced once.
- Upgrade `@bsv/sdk` to 2.8.11, Wallet Toolbox core/client to 2.14.4 and `@bsv/message-box-client` to 2.5.4.
- Monitor worker no longer fails wallet startup with "Monitor worker timeout waiting for ready signal". The worker now signals ready before loading Wallet Toolbox, which can take longer than the 10s ready timeout on a cold disk cache.
- Manage App shows monthly spending as a positive amount that updates after silent spends. The meter was negating `querySpentSince`, which is already a positive total, so current spending rendered negative and the bar stayed empty. A cached figure is still shown immediately, then refreshed, so spends under an existing grant are no longer frozen on screen.
- Upgrade Wallet Toolbox core/client to 2.14.1 so internal exact-spend metadata cannot invalidate a public `createAction` response after wallet work. Service-charge approvals, SDK 2.8.6 BRC-29 payment/refund behavior, BRC100 calls and BRC39/account-recovery formats remain compatible. Reconcile wallet history before retrying an older failed response.
- Broadcast, prove and track transactions through Arcade the same way the mobile wallet does, on mainnet, testnet and teratestnet: the toolbox's own Arcade provider is primary (Extended Format to `/tx`, with the wallet's callback token and full status updates), TAAL, GorillaPool, WhatsOnChain and Bitails follow as fallbacks that can accept a transaction but never condemn one, and proofs come from Arcade first. The monitor now subscribes to Arcade's SSE status stream, so sends, confirmations and proofs appear as they happen and the UI refreshes on each change.
- Preserve byte arrays across every BRC-100 and app-specific Electron HTTP wallet route, including current typed arrays and historical numeric-key objects, so payment, send/receive, token, cryptographic, and transaction-review flows remain compatible across wallet and app versions.

## [2.1.0] - 2026-04-08

### Features
- **Request Payment**: Users can now request Bitcoin payments from other identities via the Payments page
  - New "Request Payment" tab with recipient search, amount, description, and configurable expiry
  - New "Incoming Requests" tab showing payment request cards with Pay/Decline actions
  - Editable payment amount — payer can modify the amount before fulfilling
  - Optional notes on payments and declines
  - Outgoing request tracker with live status updates (Pending/Paid/Declined/Expired/Cancelled)
  - Cancel pending outgoing requests
- **Request Security Settings** (in Incoming Requests tab):
  - Identity whitelist with on/off toggle — only whitelisted identities can send requests when enabled
  - Identity search integration for adding to whitelist
  - Configurable min/max amount limits to filter dust and oversized requests
- Payments page reorganized into 4 full-width tabs: Send Payment, Request Payment, Incoming Requests, Pending Payments

### Dependencies
- `@bsv/message-box-client` ^2.0.6 (requires >=2.0.7 with payment request methods once published)
## [2.0.9] - 2026-03-18

### Features
- **Wallet Diagnosis tool**: New expandable section in Settings for diagnosing and repairing wallet state issues. Includes quick scan, failed/stuck transaction management, output validation, data cleanup, and change parameter reset.

### Bug Fixes
- **PeerPayClient createHmac error**: Fixed race condition where `PeerPayClient` was initialized with a stale `managers.permissionsManager` reference (undefined) due to async React state propagation. Now uses `permissionsManagerRef.current` which is set synchronously.
- **changeInitialSatoshis validation error**: Added "Reset Change Parameters" tool that restores the default basket's `minimumDesiredUTXOValue` via `Wallet.setWalletChangeParams(144, 32)`, fixing transaction failures on wallets with corrupted remote storage configuration.

## [2.0.0] - 2026-02-10

### Breaking Changes
- Upgrade BSV packages to v2 (`@bsv/sdk`, `@bsv/wallet-toolbox`, `@bsv/wallet-toolbox-client`, `@bsv/identity-react`, `@bsv/message-box-client`, `@bsv/uhrp-react`)

### Features
- **Direct-key auto-login on restart**: Returning users who authenticated with a self-managed private key are now automatically re-authenticated from the stored key material on app restart, matching the CWI-style wallet manager experience
- **Private key file backup**: Generating a random private key in direct-key mode now saves a backup file to `~/.bsv-desktop/privatekey<timestamp>.txt` (read-only), matching the existing mnemonic backup behavior
- **Legacy Bridge sweep mode**: Added a MAX toggle switch to the Send section that sets the output value to the full BSV supply, disables the amount input with explanatory placeholder text, and relabels the send button to "Sweep whole wallet". The success toast and transaction history report the actual swept amount by inspecting the transaction output

### Dependencies
- `@bsv/sdk` 2.0.1 → 2.0.2
- `@bsv/wallet-toolbox` 2.0.5 → 2.0.6
- `@bsv/wallet-toolbox-client` 2.0.5 → 2.0.6
- `electron` 38.2.0 → 38.8.0
- `electron-updater` 6.6.2 → 6.7.3
- `metanet-apps` 1.0.6 → 1.0.9
- `libphonenumber-js` 1.12.23 → 1.12.36
- `dotenv` 17.2.3 → 17.2.4
- `cors` 2.8.5 → 2.8.6
- `@types/react` 18.3.25 → 18.3.28
- `@types/node` 22.18.8 → 22.19.10
- `@types/express` 5.0.3 → 5.0.6

## [0.9.2] - 2026-02-10

### Dependencies
- Dependency updates (see 2.0.0 for details)

## [0.9.1]

- Previous release
