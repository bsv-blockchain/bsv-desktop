# Changelog

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
