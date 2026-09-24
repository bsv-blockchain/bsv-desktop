# Wallet data files

Open **Login → Account Recovery → Recover from wallet data file**, or **Settings → Wallet data files** after signing in.

An encrypted BRC-39 file holds the complete BRC-38 record set for one wallet identity and network. It does not supply signing keys. Retain your mnemonic/private-key recovery material separately. Use a long passphrase; new exports require at least 12 characters. Plaintext BRC-38 imports require no passphrase.

The native picker retains the original before validation. The screen lists the identity, network and counts of all 13 categories. Restore a separate copy to inspect/recover data without replacing the current wallet. Use as main device copy requires a matching identity/network and explicit confirmation; it drains old sessions and monitors, publishes the local storage binding, then restarts the app. Sign in with the matching keys.

Merge retains a complete before point and reconciles records in a separate database before synchronizing pages into the active wallet. A cancelled or failed merge remains resumable against the same storage identity. Modified saved reconciliation data is rejected. Before points, originals and separate copies remain available; save an encrypted copy to your chosen destination.

## Implementation and validation

The Electron main process owns files, SQLite databases, native dialogs and bounded opaque synchronization handles. The renderer cannot supply arbitrary storage paths or SQL. Streaming validation bounds the file (2 GiB), row (64 MiB), JSON nesting and Argon2 resources. Imports authenticate before publishing a verified stage. Database bindings are checked against the actual settings and identity before migrations or monitor startup.

BRC-39 uses NFC passphrases, Argon2id (7 passes, 128 MiB, one lane), independent random 32-byte salt/nonce, and AES-256-GCM. Electron builds without native Argon2 support use hash-wasm with the same parameters and bytes. Export publication is atomic. Private recovery files are retained under `~/.bsv-desktop/wallet-portability-v1`.

Run `npm run test:wallet-files` with Node-native SQLite dependencies (`npm rebuild better-sqlite3`), then `npm run rebuild:electron` before launching Electron. The regression suite covers all categories, embedded NUL text, reciprocal published-codec encryption, corrupt tags, altered stages, isolated merge resumption, queue draining and identity-bound activation. Native macOS validation additionally exercised encrypted import, failed-attempt recovery across restart, separate restore and save-dialog export; an independent Node/OpenSSL decoder verified complete fixture equality. Native Windows/Linux, remote-provider and application-level acceptance must be recorded separately.

References: [BRC-38](https://github.com/bsv-blockchain/BRCs/blob/2b959b13f1f73040d13cc4eb14edbfc376f8010b/outpoints/0038.md), [BRC-39](https://github.com/bsv-blockchain/BRCs/blob/2b959b13f1f73040d13cc4eb14edbfc376f8010b/outpoints/0039.md).

## Dependency qualification for this proposal

The wallet uses published SDK 2.8.1 (portable authenticated-empty AES-GCM repair),
Toolbox/Client 2.14.0, Message Box Client 2.5.3, BTMS 1.2.3 and permission module
1.2.1. DOMPurify 3.4.16, electron-updater 6.8.9 and compatible Express/transitive
updates address the available production graph fixes without major overrides.

A 2026-09-23 production audit still reports eight existing findings (two critical,
two high, four moderate) through legacy `bsv` 1.5.6 and `stas-js` 3.0.3: `bsv`,
`elliptic`, `bn.js`, `stas-js`, `axios`, `jest-allure`, `allure-js-commons` and
`uuid`. STAS and BSV-21 transfer construction currently use that legacy API;
substituting the incompatible `bsv` 2.x major to satisfy audit would require a
separately validated token-engine migration. This proposal does not suppress the
findings or claim a clean audit. BSVA retains release approval and the decision
on that migration; the BRC-38/39 codec uses the current `@bsv/sdk`.

## SDK 2.8.3 integration

The wallet pins published SDK 2.8.3, including the authenticated AES-GCM and bounded discovery fixes from 2.8.1/2.8.2. [TS Stack #587](https://github.com/bsv-blockchain/ts-stack/pull/587) also preserves explicit originators during HTTP discovery, binds browser JSON fetch correctly, and restores signed `listActions` net amounts using the historical wire bytes. Counts, lengths, individual output values, origin binding and response validation remain strict.

These are SDK compatibility repairs. No BRC100 application API, wire format or account-data migration is required. Existing older clients retain their calls and wire bytes; applications that bundle an affected 2.8.x client can take the SDK patch without rewriting calls. This does not impose an ecosystem-wide SDK upgrade. Wallet provider installation and standard BRC100 responses must remain compatible with older clients.

SDK release evidence includes 7,393 passing SDK tests and an old/new signed-history matrix preserving all 32 previously valid response-byte cases; the eight known 2.8.1/2.8.2 negative-history failures are recorded separately. The dependency upgrade still requires this wallet's own checks and native acceptance before release; SDK evidence alone is not app acceptance.
