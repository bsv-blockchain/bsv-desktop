# Encrypt Wallet Secrets at Rest (Security Review #5)

**Date**: 2026-06-19
**Status**: Approved design
**Scope**: bsv-desktop (Electron + React)
**Related**: `docs/SECURITY_REVIEW.md` item #5

## Problem

Wallet key material is stored in renderer `localStorage` with no real
at-rest protection:

- `localStorage.snap` — full wallet snapshot, base64. The toolbox "encrypts"
  it but stores the AES key **inside the same blob**:
  - `SimpleWalletManager`: `[ snapshotKey(32) + encryptedPayload ]`
  - `CWIStyleWalletManager` v2: `[ version=2 ][ snapshotKey(32) ][ activeProfileId(16) ][ encryptedPayload ]`
  Anyone who reads the blob off disk strips the first 32 bytes and decrypts.
  This applies to **all** login modes, not just direct-key.
- `localStorage.primaryKeyHex`, `localStorage.mnemonic12` — raw plaintext
  (direct-key mode), written in `src/lib/utils/keyMaterial.ts`.

`localStorage` persists to the Chromium LevelDB on disk in cleartext, readable
by any other process/user, captured by backups and disk theft.

## Goal

No usable key material on disk in cleartext. Move `snap`, `primaryKeyHex`,
and `mnemonic12` out of renderer `localStorage` into a main-process file
encrypted with OS-backed `safeStorage` (Electron 41).

## Non-goals / honest limits (must be documented in code)

- `safeStorage` keys are per-user (Windows DPAPI, Linux libsecret/kwallet),
  so this protects against other apps/users, backups, and disk theft — **not**
  same-user malware on Windows/Linux. macOS Keychain ACL is stronger. The
  passphrase upgrade (below) is the future answer to same-user malware.
- Plaintext key material still lives in **renderer memory** while the wallet
  runs. Unavoidable for a hot wallet; out of scope for at-rest protection.
- This does not protect against a compromised renderer (XSS): the renderer can
  still call the `secrets` IPC for the values it is allowed to read. #5 is about
  data at rest, not renderer compromise.

## Decisions (locked)

1. **Key source**: Electron `safeStorage` now (transparent, no UX change).
   A user-passphrase (KDF → AES-GCM) upgrade is left as a future opt-in setting.
2. **Storage location**: a main-process encrypted file (`userData/secrets.dat`).
   Secrets leave `localStorage` entirely.
3. **Fallback** when `safeStorage` is unavailable: store plaintext with a clear
   warning (no brick, no regression vs today).

## Architecture

### 1. Main process — `electron/secretStore.ts`

Backed by `safeStorage`. Persists `userData/secrets.dat`:

```jsonc
{
  "version": 1,
  "entries": {
    "snap":         { "enc": true,  "data": "<base64>" },
    "primaryKeyHex":{ "enc": true,  "data": "<base64>" },
    "mnemonic12":   { "enc": true,  "data": "<base64>" }
  }
}
```

API (all synchronous in main; file is small):

- `getSecret(name): string | null`
- `setSecret(name, value): void`
- `deleteSecret(name): void`
- `getAll(): Record<string, string>` — decrypts every entry for startup hydration

Encryption per entry:
- Available: `data = safeStorage.encryptString(value).toString('base64')`, `enc: true`.
- Decrypt: `safeStorage.decryptString(Buffer.from(data, 'base64'))`.
- **Fallback** (`!safeStorage.isEncryptionAvailable()` OR
  `safeStorage.getSelectedStorageBackend() === 'basic_text'`):
  `data = Buffer.from(value).toString('base64')`, `enc: false`, and log a clear
  one-time warning. The read path branches on each entry's `enc` flag, so a file
  written in fallback mode still reads correctly if encryption later becomes
  available (and is re-encrypted on next write).

**Name allow-list**: only `snap`, `primaryKeyHex`, `mnemonic12` are accepted.
Any other name throws — the IPC channel is not a general read/write oracle
(same philosophy as the storage allow-list fix for #3).

Writes are atomic: write to `secrets.dat.tmp`, then rename over `secrets.dat`.

### 2. IPC + preload

`electron/main.ts` handlers (lazy-import `secretStore`):
- `secrets:get-all` → `getAll()`
- `secrets:set` (name, value) → `setSecret`
- `secrets:delete` (name) → `deleteSecret`

`electron/preload.ts` exposes `window.electronAPI.secrets`:
- `getAll(): Promise<Record<string,string>>`
- `set(name, value): Promise<void>`
- `delete(name): Promise<void>`

Types added to `preload.ts` `ElectronAPI` and `src/global.d.ts`.

### 3. Renderer — `src/lib/services/secrets.ts`

Sync facade over an in-memory cache, so the ~30 existing call sites stay
synchronous (they currently do `localStorage.snap = …` and `getItem`).

- `async hydrate(): Promise<void>` — called once at startup. Pulls `getAll()`
  into the cache and runs migration (below).
- Snapshot: `getSnapshot(): string | null`, `setSnapshot(v: string): void`,
  `clearSnapshot(): void`.
- Key material: `getKeyHex()`, `getMnemonic()`, `setKeyMaterial(hex, mnemonic)`,
  `clearKeyMaterial()`.
- Writes update the cache immediately and fire `window.electronAPI.secrets.set`
  (persist) without blocking the caller; deletes call `secrets.delete`.

### Data flow

- **Boot** (`src/main.tsx`): wrap render in an async IIFE; `await secrets.hydrate()`
  before `root.render(...)`, so `WalletService.restoreConfigFromSnapshot()` and
  `initialize()` see hydrated values via the sync facade.
- **Read**: call sites call `secrets.getSnapshot()` etc. → cache.
- **Write**: `secrets.setSnapshot(v)` → cache updated → async encrypted persist.

### Migration (inside `hydrate`)

For each of `snap`, `primaryKeyHex`, `mnemonic12`:
1. If main `getAll()` returned it → load into cache.
2. Else if legacy `localStorage[name]` exists → load into cache,
   `await secrets.set(name, value)` (now encrypted), then
   `localStorage.removeItem(name)`.

One-time, automatic, no user action. After migration the main store is the
source of truth; `localStorage` holds no secrets.

## Call sites to migrate

- `src/lib/utils/keyMaterial.ts` — `persistKeyMaterial`, `reconcileStoredKeyMaterial`
  (`primaryKeyHex`, `mnemonic12`).
- `src/lib/services/WalletService.ts` — `localStorage.snap` reads/writes,
  `localStorage.getItem('primaryKeyHex')`, `removeItem('snap')`.
- ~10 `localStorage.snap = saveEnhancedSnapshot()` writes across pages:
  `navigation/Menu.tsx`, `pages/Greeter/index.tsx`,
  `pages/Recovery/{LostPassword,RecoverPassword,LostPhone,RecoverPresentationKey}.tsx`,
  `pages/Dashboard/Settings/{Password,RecoveryKey}/index.tsx`.

`reconcileStoredKeyMaterial` is sync today and used at module/render time; it
keeps working against the hydrated cache. Confirm during planning that all such
readers run after `hydrate()` (they render inside the React tree, which mounts
after the boot await).

## Error handling

- `secretStore` read/parse failure → treat as empty store, log; do not crash.
  (Matches current `localStorage.removeItem('snap')` on bad snapshot.)
- IPC `secrets:*` errors surface as rejected promises; renderer writes are
  best-effort with a console error + toast on failure (snapshot persistence
  failure already toasts in `WalletService`).
- Atomic temp-file write prevents a torn `secrets.dat`.

## Testing

- **Unit — `secretStore`**: round-trip encrypted; round-trip fallback (`enc:false`);
  per-entry `enc` honored on read; name allow-list rejects unknown names; atomic
  write leaves no partial file on simulated failure.
- **Unit — renderer `secrets`**: cache get/set/clear; migration moves legacy
  `localStorage` secrets into the store and clears `localStorage`.
- **Manual**: (a) fresh install creates encrypted `secrets.dat`; (b) upgrade from
  an existing plaintext install migrates and clears `localStorage`; (c) Linux with
  no keyring falls back to plaintext with a warning and still logs in.

## Out of scope (future)

- Passphrase-derived encryption (defeats same-user malware) as an opt-in setting.
- Encrypting the SQLite wallet DB (`~/.bsv-desktop/wallet.db`) — separate item.
