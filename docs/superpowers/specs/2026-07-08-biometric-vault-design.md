# Biometric Secure Enclave Vault for Wallet Secrets

**Date**: 2026-07-08  
**Status**: Approved design  
**Scope**: bsv-desktop (Electron + React)  
**Related**: `docs/superpowers/specs/2026-06-19-encrypt-secrets-at-rest-design.md`, `docs/SECURITY_REVIEW.md` item #5 (passphrase / presence upgrade)

## Problem

Wallet secrets (`snap`, `primaryKeyHex`, `mnemonic12`) are stored in a main-process file encrypted with Electron `safeStorage` (OS keychain-backed). That protects against other users, backups, and disk theft, but:

1. **Decryption is automatic** at process start via `secrets.hydrate()` — no user presence check.
2. **The wallet auto-rebuilds** from the snapshot (and, in direct-key mode, auto-provides the primary key) with no biometric or unlock step.
3. **`safeStorage` is not Secure Enclave biometry**. It does not require Touch ID / Windows Hello on each access. Same-user malware or an unlocked session can still obtain secrets once the app has started.

Auto-loading root key material on restart is weaker than a biometric (or passphrase) gate.

## Goal

- Encrypt all wallet secrets under a vault whose data-encryption key (DEK) is wrapped by platform secure hardware with **biometric user presence** where available.
- Always also wrap the DEK with a **user unlock passphrase** so recovery exists when biometrics fail, SE keys are lost, or the platform has no biometric secure element.
- On every **cold start**, require successful vault unlock **before** any secret is available in memory and **before** the wallet is built from the snapshot/key.
- After unlock, preserve existing auth: WAB/CWI still require password/phone; direct-key may auto-provide the primary key once secrets are unlocked.

## Non-goals (v1)

- Idle timeout or OS sleep/screen-lock re-lock (cold start only).
- Encrypting the SQLite wallet DB (`wallet.db`) with the vault DEK.
- Replacing wallet presentation-password / recovery-key flows (those remain separate from the **vault unlock passphrase**).
- Protecting secrets in renderer/main memory while the wallet is unlocked and running (hot-wallet limitation).
- Defending a fully compromised renderer that can call post-unlock IPC (same bound as today’s secret IPC model).

## Decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Gate all wallet secrets** (`snap`, `primaryKeyHex`, `mnemonic12`) | Snapshot alone contains key material usable offline; gating only `primaryKeyHex` is insufficient. |
| 2 | **Biometrics unlock secrets; existing auth still runs** | Biometrics protect at-rest/auto-load; WAB/CWI password remains the presentation-key gate. |
| 3 | **Passphrase required when biometrics unavailable; passphrase always enrolled** | Portable security and recovery if SE key is lost or biometrics fail. |
| 4 | **Re-lock only on cold start (v1)** | Matches “when the program is closed”; defers idle lock complexity. |
| 5 | **SE-wrapped vault DEK + passphrase wrap** | Strongest SE story with a real recovery path (vs biometrics-as-convenience-only or raw Keychain ACL items). |
| 6 | **Non-secret boot config outside the vault** | Unlock UI and post-unlock routing need network/login-type flags without decrypting secrets. |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer                                                     │
│  UnlockScreen → vault.unlock(bio | passphrase)               │
│  WalletService.restoreConfig / initialize (only after unlock)│
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (gated)
┌──────────────────────────▼──────────────────────────────────┐
│ Main process                                                 │
│  vault.ts     — AES-256-GCM seal/open of secret map with DEK │
│  keyWrap.ts   — wrap/unwrap DEK via adapters:                │
│    • SecureEnclaveAdapter (macOS)                            │
│    • WindowsHelloAdapter (Windows)                           │
│    • PassphraseAdapter (all platforms; always available)     │
│  vault.dat    — sealed ciphertext + wraps at rest            │
│  boot-config  — non-secret flags for unlock UI / routing     │
└─────────────────────────────────────────────────────────────┘
```

### Components

1. **`electron/vault.ts`**  
   Owns vault file I/O, in-memory unlocked state (`dek`, decrypted secret map), enroll/unlock/lock, and re-seal on write.

2. **`electron/keyWrap.ts` + platform adapters**  
   Abstract `wrap(dek)` / `unwrap(blob)` with optional `prompt: string` for biometry UI.

3. **`electron/bootConfig.ts`**  
   Reads/writes non-secret boot config used before unlock.

4. **Renderer `src/lib/services/secrets.ts`**  
   Stays a sync facade, but:
   - `hydrate()` only loads after unlock (or returns locked empty state).
   - New `unlock*` / `status` APIs bridge to main vault IPC.
   - Pre-unlock reads of secrets return `null` / throw consistently.

5. **`UnlockScreen` (React)**  
   Shown when vault exists and is locked. Biometrics primary CTA when enrolled; passphrase always available.

6. **`WalletService` lifecycle**  
   `restoreConfigFromSnapshot` / `initialize` / auto-key provision run only after unlock signals secrets ready. Boot config may restore non-secret routing earlier.

### Data flow

**Cold start (returning user)**

1. Main loads `boot-config.json` only; vault stays sealed.
2. Renderer mounts Unlock UI (no full secret hydrate).
3. User authenticates with biometrics or passphrase.
4. Main unwraps DEK → decrypts vault into memory.
5. Renderer hydrates secret cache via IPC.
6. `WalletService` restores snapshot config + initializes managers.
7. Existing auth: direct-key auto-provide key; WAB/CWI password/phone as today.

**While running**

- DEK and secrets remain in main-process memory until process exit.
- Secret writes update the in-memory map and re-encrypt `vault.dat` with the same DEK (wraps unchanged).

**New setup / first persist**

- Before first durable write of `snap` / key material, force vault enrollment (passphrase required; biometrics if available).
- No secret is written to disk outside the vault after enrollment.

**Logout**

- Clear secret entries (same semantics as today).
- Destroy in-memory DEK; delete or empty vault as appropriate for full local wipe; clear boot vault flags.

## Data model

### `userData/vault.dat` (version 2)

```jsonc
{
  "version": 2,
  "kdf": {
    "alg": "argon2id",
    "salt": "<base64>",
    "params": { "m": 65536, "t": 3, "p": 1 }
  },
  "wraps": {
    "se": {
      "platform": "darwin",
      "label": "bsv-desktop-vault-dek",
      "blob": "<base64>"
    },
    "passphrase": {
      "blob": "<base64>"
    }
  },
  "nonce": "<base64>",
  "ciphertext": "<base64>",
  "aad": "bsv-desktop-vault-v2"
}
```

**Payload (plaintext inside AES-GCM)** — JSON object with allow-listed keys only:

```jsonc
{
  "snap": "...",
  "primaryKeyHex": "...",
  "mnemonic12": "..."
}
```

Missing keys are omitted (same as optional entries today).

**Crypto**

- DEK: 32 random bytes (`crypto.randomBytes(32)`).
- Vault body: AES-256-GCM; AAD = versioned constant `bsv-desktop-vault-v2`.
- Passphrase wrap: Argon2id (params as above, tunable) → 32-byte key → AES-256-GCM wrap of DEK (separate nonce inside `wraps.passphrase.blob` structure).
- SE wrap: platform-specific; opaque `blob` + metadata. Implementation must ensure unwrap requires user presence (biometry) on supported hardware.

### `userData/boot-config.json` (unencrypted, non-secret)

Example fields:

```jsonc
{
  "version": 1,
  "hasVault": true,
  "unlockMethods": ["se", "passphrase"],
  "network": "main",
  "loginType": "wab",
  "wabUrl": "...",
  "storageUrl": "...",
  "messageBoxUrl": "...",
  "authMethod": "...",
  "useRemoteStorage": true,
  "useMessageBox": false,
  "backupStorageUrls": []
}
```

Rules:

- No key material, no snapshot blob, no mnemonic.
- Updated whenever wallet config is finalized or snapshot config is saved.
- Unlock screen and early routing may read this without unlocking.

### Relationship to v1 `secrets.dat`

- v1 used per-entry `safeStorage` encryption and auto-decrypted on `getAll()`.
- v2 replaces that as the durable store for secrets. After successful migration, `secrets.dat` is deleted.
- In-memory post-unlock API for the renderer remains conceptually `get/set/delete` on the same three names so call sites stay small.

## Migration from v1

On first launch after upgrade:

1. If `vault.dat` exists → normal locked boot.
2. Else if `secrets.dat` exists:
   - Decrypt with existing `safeStorage` path (same as today).
   - Present mandatory “Protect your wallet” enrollment: set unlock passphrase; enable biometrics when available.
   - Generate DEK; encrypt payload; create wraps; write `vault.dat`; write `boot-config.json` from snapshot config if present.
   - Delete `secrets.dat` and any remaining legacy `localStorage` secret keys.
3. Else → new user; enroll vault at first secret persist.

**Enrollment policy**

- Passphrase is **required** at enroll (ensures recovery if SE wrap is lost).
- Biometrics enrolled when `SecureEnclaveAdapter` / Windows Hello reports available; stored as `wraps.se`.
- User cannot dismiss enrollment and continue using auto-unlocked secrets (no silent v1 fallback after upgrade path is entered).

## Unlock UX

- **Primary button**: “Unlock with Touch ID” / “Windows Hello” when `se` is in `unlockMethods` and platform reports availability.
- **Secondary**: “Unlock with passphrase”.
- Wrong passphrase: stay locked; show error; apply light rate limiting (exponential backoff after repeated failures) to slow offline brute force of the wrapped DEK.
- Biometric cancel/fail: stay locked; offer passphrase without alarming “wipe” messaging.
- After unlock: existing greeter / password / dashboard flows unchanged.

**Copy distinction (document in UI)**

- **Vault unlock passphrase** — unlocks local secret storage on this device.
- **Wallet password / recovery key** — existing WAB/CWI presentation and recovery; not replaced by the vault passphrase.

## Platform adapters

| Platform | Adapter | Behavior |
|----------|---------|----------|
| macOS (SE + biometry capable) | `SecureEnclaveAdapter` | Create/use SE-backed key (or Keychain key with biometry access control) to wrap/unwrap DEK; system biometric prompt with app-attributed reason string. |
| Windows (Hello capable) | `WindowsHelloAdapter` | Hello / TPM-backed wrap with user presence. |
| Linux / no biometry / VMs | — | No `se` wrap; passphrase-only. Honest UI: “This device has no biometric secure element.” |
| All | `PassphraseAdapter` | Argon2id + AES wrap; always available after enroll. |

Native dependency choice is an implementation detail, constrained by:

- Electron 41 packaging (electron-builder, asar unpack for native addons).
- Ability to set biometry access control on private key use.
- Testability via mock adapters in unit tests.

Prefer a thin native module over shelling out to `security` / PowerShell for crypto operations.

## IPC surface

### Vault (new)

```ts
vault.status(): Promise<{
  locked: boolean
  hasVault: boolean
  methods: Array<'se' | 'passphrase'>
  biometricsAvailable: boolean
}>

vault.unlockWithBiometrics(): Promise<{ ok: true } | { ok: false; error: string }>
vault.unlockWithPassphrase(passphrase: string): Promise<{ ok: true } | { ok: false; error: string }>
vault.enroll(options: {
  passphrase: string
  enableBiometrics: boolean
}): Promise<{ ok: true } | { ok: false; error: string }>

vault.lock(): Promise<void>  // clear DEK + secret map from memory (tests; future idle lock)
```

### Secrets (post-unlock only; same allow-list)

```ts
secrets.getAll(): Promise<Record<string, string>>  // throws or returns {} if locked
secrets.set(name: string, value: string): Promise<void>
secrets.delete(name: string): Promise<void>
```

**Lock policy**

- If vault is locked, `secrets.getAll` does not call `safeStorage` auto-decrypt and does not return ciphertext as plaintext.
- Allowed names remain only: `snap`, `primaryKeyHex`, `mnemonic12`.

### Boot config

```ts
bootConfig.get(): Promise<BootConfig | null>
bootConfig.set(config: BootConfig): Promise<void>
```

## WalletService & HTTP integration

1. **Startup order**  
   `main.tsx`: do not fully hydrate secrets before first paint when `hasVault && locked`. Show unlock gate; on success, hydrate then mount wallet tree (or mount shell with gate overlay that unblocks service init).

2. **`restoreConfigFromSnapshot`**  
   Prefer boot-config for pre-unlock routing; after unlock, reconcile with snapshot-embedded config as today.

3. **`initialize` / direct-key auto-provide**  
   Only after unlock. No read of `primaryKeyHex` while locked.

4. **HTTP server (BRC-100)**  
   While locked, wallet method dispatch returns a stable error (e.g. `WALLET_LOCKED`) so local clients cannot race an unlocked session. Server may still listen; handlers refuse until ready.

## Error handling & recovery

| Situation | Behavior |
|-----------|----------|
| Biometric cancel / fail | Stay locked; offer passphrase. |
| Wrong passphrase | Stay locked; rate-limit attempts. |
| Corrupt vault file | Error UI; point to recovery (mnemonic / WAB / re-import). Do not silently wipe without confirmation. |
| SE key lost, passphrase wrap present | Passphrase unlock works; optionally re-enroll biometrics after unlock. |
| SE key lost, no passphrase wrap | Should not occur if enroll always required passphrase; if encountered, vault is unrecoverable from this copy — recovery via external backup only. |
| OS encryption / native module missing | Passphrase-only path; clear messaging. |

## Testing

**Unit**

- Vault seal/open round-trip with fixed DEK.
- Passphrase wrap/unwrap; wrong passphrase fails.
- Mock SE adapter wrap/unwrap and “user cancelled”.
- Locked vs unlocked secret IPC allow-list and denial.
- Migration: v1 `secrets.dat` → v2 `vault.dat` then delete v1.
- Rate limiting on failed passphrase unlocks.

**Integration / manual**

- Cold start shows unlock; secrets null until unlock.
- Direct-key: biometrics → wallet ready without password.
- WAB/CWI: biometrics → still password/phone.
- Linux passphrase-only path.
- Logout clears vault material appropriately.
- BRC-100 client receives locked error pre-unlock.

## Security properties (honest limits)

| Threat | Mitigated? |
|--------|------------|
| Disk theft / offline copy of `userData` | Yes — ciphertext only; needs biometrics **or** passphrase. |
| Other OS users | Yes (same + file perms). |
| Auto-login without user presence after restart | Yes — cold-start unlock required. |
| Same-user malware while wallet unlocked | No — secrets in process memory; post-unlock IPC available to compromised renderer. |
| Compromised renderer pre-unlock | Cannot read vault plaintext via secrets IPC. |
| Offline brute force of passphrase wrap | Slowed by Argon2id + attempt backoff; weak passphrases remain weak — UI should encourage strong unlock passphrase. |
| Evil maid with SE + strong passphrase | High bar; not in scope to defeat nation-state against SE. |

## Implementation notes

- Build on (and largely replace for secrets I/O) `electron/secretStore.ts` patterns: allow-list names, atomic write (`.tmp` + rename), `0o600` modes.
- Prefer pure JS crypto (`crypto` / `@noble` / `argon2` native) for AES-GCM and KDF; isolate native code to SE/Hello only.
- Keep renderer call-site churn low: most pages keep using `secrets.setSnapshot` etc.; only boot and enrollment/unlock UI are new surfaces.
- Document that vault unlock passphrase ≠ wallet password in Settings and enrollment copy.

## PR Plan

### PR 1 — Vault core + passphrase adapter (no UI)

- Add `electron/vault.ts`, passphrase wrap, AES-GCM seal, atomic file format v2.
- Unit tests for seal/open, wrap, locked state.
- IPC stubs with lock enforcement; keep v1 `secrets.dat` path working until PR 3.

### PR 2 — Platform biometric adapters

- macOS Secure Enclave / biometry wrap (required for macOS builds).
- Windows Hello adapter (required for Windows builds; if Hello unavailable at runtime, treat as passphrase-only).
- Capability detection + `vault.status().biometricsAvailable`.
- Tests with mocks; manual checklist for real hardware.

### PR 3 — Migration + boot config + gated hydrate

- `boot-config.json` writer/reader.
- Migrate v1 `secrets.dat` → vault on first run (enroll required).
- Change `secrets.hydrate` / `main.tsx` so secrets are not available pre-unlock.
- WalletService gates on unlock; HTTP locked error.

### PR 4 — Unlock / enroll UI + copy

- Unlock screen (biometrics + passphrase).
- First-run / migration enrollment (passphrase required, biometrics optional CTA).
- Settings note distinguishing vault passphrase vs wallet password.
- i18n strings.

### PR 5 — Polish & hardening

- Rate limiting, error UX, logout/wipe paths.
- Packaging native modules for macOS/Windows release builds.
- Manual QA matrix (Mac Touch ID, Windows Hello, Linux passphrase).

## Open questions

None remaining for v1 scope; the following are explicitly deferred:

- Idle / screen-lock re-lock.
- Using vault DEK for SQLite encryption.
- Passphrase change / SE re-enrollment UX refinements beyond “unlock then re-enroll biometrics”.

## Key Decisions

1. **All secrets gated** — snapshot + keys + mnemonic sealed together so offline snapshot theft is not a bypass.
2. **SE-wrapped DEK + mandatory passphrase wrap** — hardware presence where available; recovery and non-SE platforms always covered.
3. **Biometrics then existing wallet auth** — does not collapse WAB/CWI password into Touch ID.
4. **Cold-start-only re-lock for v1** — ship presence gate without session-timeout complexity.
5. **Boot config outside vault** — unlock and routing without decrypting secrets.
6. **Mandatory migration enrollment** — no silent retention of auto-decrypt v1 behavior after upgrade.
)
