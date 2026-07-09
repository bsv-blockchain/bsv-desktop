# Encrypt Wallet Secrets at Rest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `snap`, `primaryKeyHex`, and `mnemonic12` out of renderer `localStorage` into a main-process file encrypted with Electron `safeStorage`.

**Architecture:** A main-process `secretStore` module reads/writes `userData/secrets.dat` (per-entry `safeStorage` ciphertext, plaintext fallback when OS encryption is unavailable). It is reached over three IPC channels. A renderer `secrets` module is a synchronous facade over an in-memory cache hydrated once at startup; it migrates legacy plaintext `localStorage` values on first run. All ~30 existing secret call sites route through the facade.

**Tech Stack:** Electron 41 (`safeStorage`, `app`), TypeScript, Vitest (node env, `vi.mock`), React.

## Global Constraints

- Only secret names permitted anywhere: `snap`, `primaryKeyHex`, `mnemonic12`. Any other name throws (main) — the IPC channel is not a general oracle.
- Fallback when `!safeStorage.isEncryptionAvailable()` OR `safeStorage.getSelectedStorageBackend() === 'basic_text'`: store base64 plaintext with `enc:false` and log a one-time warning. Never brick login.
- Secrets must end up out of `localStorage` after migration.
- `secrets.dat` lives in `app.getPath('userData')`, written atomically (`.tmp` then rename), mode `0o600`.
- Tests: `npx vitest run --config vitest.config.electron.ts <file>`. Test files live in `test/`, node env, mock `electron`/`window` then dynamic-import the module under test (see `test/onWalletReady.test.ts`).
- Electron typecheck: `npx tsc -p tsconfig.electron.json --noEmit`. Renderer typecheck: `npx tsc --noEmit` (note: 2 pre-existing `WalletService.ts` `@bsv/sdk` nested-version errors are unrelated baseline noise — count must not exceed 2).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Main-process `secretStore`

**Files:**
- Create: `electron/secretStore.ts`
- Test: `test/secretStore.test.ts`

**Interfaces:**
- Consumes: `electron` (`app.getPath`, `safeStorage`), `fs`, `path`.
- Produces:
  - `getSecret(name: string): string | null`
  - `setSecret(name: string, value: string): void`
  - `deleteSecret(name: string): void`
  - `getAll(): Record<string, string>`

- [ ] **Step 1: Write the failing test**

Create `test/secretStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

// Per-run temp userData dir
const TMP = path.join(os.tmpdir(), `secretstore-test-${process.pid}-${Date.now()}`)

let encAvailable = true
let backend = 'keychain'

vi.mock('electron', () => ({
  app: { getPath: () => TMP },
  safeStorage: {
    isEncryptionAvailable: () => encAvailable,
    getSelectedStorageBackend: () => backend,
    // reversible stand-in for real OS crypto
    encryptString: (s: string) => Buffer.from('ENC:' + s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^ENC:/, ''),
  },
}))

let store: typeof import('../electron/secretStore')

describe('secretStore', () => {
  beforeEach(async () => {
    encAvailable = true
    backend = 'keychain'
    fs.rmSync(TMP, { recursive: true, force: true })
    fs.mkdirSync(TMP, { recursive: true })
    vi.resetModules()
    store = await import('../electron/secretStore')
  })

  it('round-trips an encrypted secret and persists ciphertext (not plaintext)', () => {
    store.setSecret('snap', 'hello-snapshot')
    expect(store.getSecret('snap')).toBe('hello-snapshot')
    const raw = fs.readFileSync(path.join(TMP, 'secrets.dat'), 'utf8')
    expect(raw).not.toContain('hello-snapshot')
    const parsed = JSON.parse(raw)
    expect(parsed.entries.snap.enc).toBe(true)
  })

  it('falls back to plaintext when encryption unavailable', () => {
    encAvailable = false
    store.setSecret('snap', 'plain-value')
    expect(store.getSecret('snap')).toBe('plain-value')
    const parsed = JSON.parse(fs.readFileSync(path.join(TMP, 'secrets.dat'), 'utf8'))
    expect(parsed.entries.snap.enc).toBe(false)
  })

  it('treats basic_text backend as unencrypted fallback', () => {
    backend = 'basic_text'
    store.setSecret('snap', 'v')
    const parsed = JSON.parse(fs.readFileSync(path.join(TMP, 'secrets.dat'), 'utf8'))
    expect(parsed.entries.snap.enc).toBe(false)
  })

  it('reads each entry per its own enc flag', () => {
    store.setSecret('snap', 'encrypted-one')
    encAvailable = false
    store.setSecret('primaryKeyHex', 'plain-one')
    encAvailable = true
    const all = store.getAll()
    expect(all.snap).toBe('encrypted-one')
    expect(all.primaryKeyHex).toBe('plain-one')
  })

  it('rejects names not on the allow-list', () => {
    expect(() => store.setSecret('evil', 'x')).toThrow(/not permitted/)
    expect(() => store.getSecret('evil')).toThrow(/not permitted/)
  })

  it('getAll on missing file returns empty object', () => {
    expect(store.getAll()).toEqual({})
  })

  it('deleteSecret removes only that entry', () => {
    store.setSecret('snap', 'a')
    store.setSecret('mnemonic12', 'b')
    store.deleteSecret('snap')
    expect(store.getSecret('snap')).toBeNull()
    expect(store.getSecret('mnemonic12')).toBe('b')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.electron.ts test/secretStore.test.ts`
Expected: FAIL — cannot resolve `../electron/secretStore`.

- [ ] **Step 3: Write minimal implementation**

Create `electron/secretStore.ts`:

```ts
import { app, safeStorage } from 'electron'
import path from 'path'
import fs from 'fs'

/** Only these secret names may be stored or read. */
const ALLOWED: ReadonlySet<string> = new Set(['snap', 'primaryKeyHex', 'mnemonic12'])

interface Entry { enc: boolean; data: string }
interface SecretFile { version: number; entries: Record<string, Entry> }

function assertAllowed(name: string): void {
  if (!ALLOWED.has(name)) throw new Error(`secretStore: name not permitted: ${name}`)
}

function filePath(): string {
  return path.join(app.getPath('userData'), 'secrets.dat')
}

/** True only when the OS provides real encryption (not Linux basic_text). */
function encAvailable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    const getBackend = (safeStorage as any).getSelectedStorageBackend
    if (typeof getBackend === 'function' && getBackend.call(safeStorage) === 'basic_text') return false
    return true
  } catch {
    return false
  }
}

function readFile(): SecretFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.entries) return parsed as SecretFile
  } catch {
    // missing or corrupt file -> empty store
  }
  return { version: 1, entries: {} }
}

function writeFile(data: SecretFile): void {
  const tmp = filePath() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
  fs.renameSync(tmp, filePath())
}

let warned = false
function warnFallbackOnce(): void {
  if (warned) return
  warned = true
  console.warn(
    '[secretStore] OS encryption unavailable — wallet secrets stored UNENCRYPTED on disk. ' +
    'Install/enable a keyring (libsecret or kwallet) for at-rest protection.'
  )
}

function decodeEntry(entry: Entry): string {
  return entry.enc
    ? safeStorage.decryptString(Buffer.from(entry.data, 'base64'))
    : Buffer.from(entry.data, 'base64').toString('utf8')
}

export function getSecret(name: string): string | null {
  assertAllowed(name)
  const entry = readFile().entries[name]
  return entry ? decodeEntry(entry) : null
}

export function setSecret(name: string, value: string): void {
  assertAllowed(name)
  const file = readFile()
  if (encAvailable()) {
    file.entries[name] = { enc: true, data: safeStorage.encryptString(value).toString('base64') }
  } else {
    warnFallbackOnce()
    file.entries[name] = { enc: false, data: Buffer.from(value, 'utf8').toString('base64') }
  }
  writeFile(file)
}

export function deleteSecret(name: string): void {
  assertAllowed(name)
  const file = readFile()
  if (file.entries[name]) {
    delete file.entries[name]
    writeFile(file)
  }
}

export function getAll(): Record<string, string> {
  const file = readFile()
  const out: Record<string, string> = {}
  for (const name of Object.keys(file.entries)) {
    if (!ALLOWED.has(name)) continue
    try {
      out[name] = decodeEntry(file.entries[name])
    } catch (err) {
      console.error(`[secretStore] failed to read secret ${name}:`, err)
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.electron.ts test/secretStore.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck electron**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add electron/secretStore.ts test/secretStore.test.ts
git commit -m "feat(secrets): main-process safeStorage-backed secret store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: IPC handlers + preload exposure

**Files:**
- Modify: `electron/main.ts` (add handlers near the other `ipcMain.handle` blocks, ~line 440)
- Modify: `electron/preload.ts` (add `secrets` to exposed API + `ElectronAPI` interface)
- Modify: `src/global.d.ts` (add `secrets` to the window API type)

**Interfaces:**
- Consumes: `electron/secretStore` (`getAll`, `setSecret`, `deleteSecret`).
- Produces: `window.electronAPI.secrets`:
  - `getAll(): Promise<Record<string, string>>`
  - `set(name: string, value: string): Promise<void>`
  - `delete(name: string): Promise<void>`

- [ ] **Step 1: Add IPC handlers in `electron/main.ts`**

Add a lazy loader near the other lazy loaders (after `getUpdaterModule`, ~line 27):

```ts
// Lazy load secret store to avoid loading it before app is ready
let secretStoreModule: typeof import('./secretStore.js') | null = null
async function getSecretStore() {
  if (!secretStoreModule) {
    secretStoreModule = await import('./secretStore.js')
  }
  return secretStoreModule
}
```

Add handlers in the IPC section (after the storage handlers, before the auto-update handlers, ~line 441):

```ts
// ===== Secret Store IPC Handlers =====

ipcMain.handle('secrets:get-all', async () => {
  const store = await getSecretStore()
  return store.getAll()
})

ipcMain.handle('secrets:set', async (_event, name: string, value: string) => {
  const store = await getSecretStore()
  store.setSecret(name, value)
})

ipcMain.handle('secrets:delete', async (_event, name: string) => {
  const store = await getSecretStore()
  store.deleteSecret(name)
})
```

- [ ] **Step 2: Expose in `electron/preload.ts`**

Add to the `exposeInMainWorld('electronAPI', { ... })` object (after the `storage` block, ~line 46):

```ts
  // Secret store (encrypted at rest in the main process)
  secrets: {
    getAll: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke('secrets:get-all'),
    set: (name: string, value: string): Promise<void> =>
      ipcRenderer.invoke('secrets:set', name, value),
    delete: (name: string): Promise<void> =>
      ipcRenderer.invoke('secrets:delete', name),
  },
```

Add to the `ElectronAPI` interface (after the `storage` block, ~line 93):

```ts
  secrets: {
    getAll: () => Promise<Record<string, string>>;
    set: (name: string, value: string) => Promise<void>;
    delete: (name: string) => Promise<void>;
  };
```

- [ ] **Step 3: Add to `src/global.d.ts`**

Open `src/global.d.ts`, find the `electronAPI` window type with the `storage` block, and add immediately after it:

```ts
    secrets: {
      getAll: () => Promise<Record<string, string>>;
      set: (name: string, value: string) => Promise<void>;
      delete: (name: string) => Promise<void>;
    };
```

(Match the existing indentation/style in that file — confirm by reading it first.)

- [ ] **Step 4: Typecheck both projects**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: exit 0.
Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `2` (the pre-existing WalletService baseline; no new errors).

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/global.d.ts
git commit -m "feat(secrets): expose secret store over IPC

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Renderer `secrets` facade + migration

**Files:**
- Create: `src/lib/services/secrets.ts`
- Test: `test/secrets.renderer.test.ts`

**Interfaces:**
- Consumes: `window.electronAPI.secrets` (Task 2), `window.localStorage`.
- Produces (all synchronous except `hydrate`):
  - `hydrate(): Promise<void>`
  - `getSnapshot(): string | null`, `setSnapshot(v: string): void`, `clearSnapshot(): void`
  - `getKeyHex(): string | null`, `setKeyHex(v: string): void`, `clearKeyHex(): void`
  - `getMnemonic(): string | null`, `setMnemonic(v: string): void`, `clearMnemonic(): void`
  - `_reset(): void` (test-only)

- [ ] **Step 1: Write the failing test**

Create `test/secrets.renderer.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const backing = new Map<string, string>()
const mockGetAll = vi.fn(async () => Object.fromEntries(backing))
const mockSet = vi.fn(async (name: string, value: string) => { backing.set(name, value) })
const mockDelete = vi.fn(async (name: string) => { backing.delete(name) })

const localStore = new Map<string, string>()
;(globalThis as any).window = {
  electronAPI: { secrets: { getAll: mockGetAll, set: mockSet, delete: mockDelete } },
}
;(globalThis as any).localStorage = {
  getItem: (k: string) => (localStore.has(k) ? localStore.get(k)! : null),
  setItem: (k: string, v: string) => { localStore.set(k, v) },
  removeItem: (k: string) => { localStore.delete(k) },
}

let secrets: typeof import('../src/lib/services/secrets')

describe('renderer secrets facade', () => {
  beforeEach(async () => {
    backing.clear(); localStore.clear()
    mockGetAll.mockClear(); mockSet.mockClear(); mockDelete.mockClear()
    vi.resetModules()
    secrets = await import('../src/lib/services/secrets')
    secrets._reset()
  })

  it('hydrates from the main store into the sync cache', async () => {
    backing.set('snap', 'S'); backing.set('primaryKeyHex', 'K')
    await secrets.hydrate()
    expect(secrets.getSnapshot()).toBe('S')
    expect(secrets.getKeyHex()).toBe('K')
    expect(secrets.getMnemonic()).toBeNull()
  })

  it('migrates legacy localStorage values into the store and clears them', async () => {
    localStore.set('snap', 'legacy-snap')
    localStore.set('mnemonic12', 'legacy-mn')
    await secrets.hydrate()
    expect(secrets.getSnapshot()).toBe('legacy-snap')
    expect(secrets.getMnemonic()).toBe('legacy-mn')
    expect(mockSet).toHaveBeenCalledWith('snap', 'legacy-snap')
    expect(mockSet).toHaveBeenCalledWith('mnemonic12', 'legacy-mn')
    expect(localStore.has('snap')).toBe(false)
    expect(localStore.has('mnemonic12')).toBe(false)
  })

  it('prefers the main store over legacy localStorage', async () => {
    backing.set('snap', 'from-store')
    localStore.set('snap', 'from-legacy')
    await secrets.hydrate()
    expect(secrets.getSnapshot()).toBe('from-store')
    expect(localStore.get('snap')).toBe('from-legacy') // not migrated/cleared
  })

  it('setSnapshot updates cache synchronously and persists async', async () => {
    await secrets.hydrate()
    secrets.setSnapshot('new-snap')
    expect(secrets.getSnapshot()).toBe('new-snap')
    await Promise.resolve()
    expect(mockSet).toHaveBeenCalledWith('snap', 'new-snap')
  })

  it('clearSnapshot removes from cache and store', async () => {
    backing.set('snap', 'S')
    await secrets.hydrate()
    secrets.clearSnapshot()
    expect(secrets.getSnapshot()).toBeNull()
    await Promise.resolve()
    expect(mockDelete).toHaveBeenCalledWith('snap')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.electron.ts test/secrets.renderer.test.ts`
Expected: FAIL — cannot resolve `../src/lib/services/secrets`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/services/secrets.ts`:

```ts
/**
 * Renderer-side synchronous facade over the encrypted main-process secret
 * store (electron/secretStore.ts). Holds an in-memory cache hydrated once at
 * startup so existing synchronous call sites keep working; writes update the
 * cache immediately and persist asynchronously over IPC.
 */
const SNAP = 'snap'
const KEY = 'primaryKeyHex'
const MN = 'mnemonic12'
const NAMES = [SNAP, KEY, MN] as const

const cache = new Map<string, string>()
let hydrated = false

export async function hydrate(): Promise<void> {
  if (hydrated) return
  const stored = await window.electronAPI.secrets.getAll()
  for (const name of NAMES) {
    if (stored[name] != null) {
      cache.set(name, stored[name])
      continue
    }
    // One-time migration of legacy plaintext localStorage values.
    const legacy = localStorage.getItem(name)
    if (legacy != null) {
      cache.set(name, legacy)
      try {
        await window.electronAPI.secrets.set(name, legacy)
        localStorage.removeItem(name)
      } catch (err) {
        console.error(`[secrets] migration of ${name} failed:`, err)
      }
    }
  }
  hydrated = true
}

function get(name: string): string | null {
  return cache.has(name) ? cache.get(name)! : null
}

function set(name: string, value: string): void {
  cache.set(name, value)
  void window.electronAPI.secrets
    .set(name, value)
    .catch((err) => console.error(`[secrets] persist ${name} failed:`, err))
}

function clear(name: string): void {
  cache.delete(name)
  void window.electronAPI.secrets
    .delete(name)
    .catch((err) => console.error(`[secrets] delete ${name} failed:`, err))
}

export const getSnapshot = (): string | null => get(SNAP)
export const setSnapshot = (v: string): void => set(SNAP, v)
export const clearSnapshot = (): void => clear(SNAP)

export const getKeyHex = (): string | null => get(KEY)
export const setKeyHex = (v: string): void => set(KEY, v)
export const clearKeyHex = (): void => clear(KEY)

export const getMnemonic = (): string | null => get(MN)
export const setMnemonic = (v: string): void => set(MN, v)
export const clearMnemonic = (): void => clear(MN)

/** Test-only: reset module state. */
export function _reset(): void {
  cache.clear()
  hydrated = false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.electron.ts test/secrets.renderer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/secrets.ts test/secrets.renderer.test.ts
git commit -m "feat(secrets): renderer sync facade + legacy migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Hydrate at boot + migrate all call sites

**Files:**
- Modify: `src/main.tsx` (await `hydrate()` before render)
- Modify: `src/lib/utils/keyMaterial.ts` (`primaryKeyHex`/`mnemonic12`)
- Modify: `src/lib/services/WalletService.ts` (`snap`, `primaryKeyHex`)
- Modify (snapshot writes): `src/lib/navigation/Menu.tsx`, `src/lib/pages/Greeter/index.tsx`, `src/lib/pages/Recovery/LostPassword.tsx`, `src/lib/pages/Recovery/RecoverPassword.tsx`, `src/lib/pages/Recovery/LostPhone.tsx`, `src/lib/pages/Recovery/RecoverPresentationKey.tsx`, `src/lib/pages/Dashboard/Settings/Password/index.tsx`, `src/lib/pages/Dashboard/Settings/RecoveryKey/index.tsx`

**Interfaces:**
- Consumes: `src/lib/services/secrets` (Task 3) — `hydrate`, `getSnapshot/setSnapshot/clearSnapshot`, `getKeyHex/setKeyHex/clearKeyHex`, `getMnemonic/setMnemonic/clearMnemonic`.
- Produces: no new exports; behavior change only.

- [ ] **Step 1: Hydrate before render in `src/main.tsx`**

Replace the render block so hydration completes first. Add the import at top:

```ts
import { hydrate as hydrateSecrets } from './lib/services/secrets';
```

Wrap the existing `root.render(...)` call:

```ts
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  // Load (and migrate) encrypted secrets into the sync cache before the wallet
  // tree mounts, so snapshot/key reads during init see hydrated values.
  hydrateSecrets()
    .catch((err) => console.error('[main] secret hydration failed:', err))
    .finally(() => {
      root.render(
        <React.StrictMode>
          <UserInterface
            onWalletReady={onWalletReady}
            nativeHandlers={electronFunctions}
            appVersion={packageJson.version}
            appName="BSV Desktop"
            permissionModules={[btmsPermissionModule]}
          />
        </React.StrictMode>
      );
    });
}
```

- [ ] **Step 2: Migrate `src/lib/utils/keyMaterial.ts`**

Add import at top:

```ts
import * as secrets from '../services/secrets'
```

Replace `persistKeyMaterial` body lines that touch localStorage:

```ts
export const persistKeyMaterial = (keyHex: string, mnemonic?: string): string => {
  const phrase = mnemonic ? normalizeMnemonic(mnemonic) : mnemonicFromKeyHex(keyHex)
  secrets.setKeyHex(keyHex)
  secrets.setMnemonic(phrase)
  return phrase
}
```

In `reconcileStoredKeyMaterial`, replace the reads and the error-path removal:

```ts
  const storedMnemonic = (secrets.getMnemonic() || '').trim()
  const storedHex = (secrets.getKeyHex() || '').trim()
```

and the catch branch `localStorage.removeItem('mnemonic12')` becomes:

```ts
      secrets.clearMnemonic()
```

(Leave the `typeof window === 'undefined'` guard as-is.)

- [ ] **Step 3: Migrate `src/lib/services/WalletService.ts`**

Add import near the top of the file (match existing import style):

```ts
import * as secrets from './secrets'
```

Apply these replacements (every occurrence):
- `localStorage.snap` (read) → `secrets.getSnapshot()`
- `!localStorage.snap` → `!secrets.getSnapshot()`
- `localStorage.snap = <expr>` → `secrets.setSnapshot(<expr>)`
- `localStorage.getItem('primaryKeyHex')` → `secrets.getKeyHex()`
- `localStorage.removeItem('snap')` → `secrets.clearSnapshot()`

Note line 294/666 use the value: `Utils.toArray(localStorage.snap, 'base64')` → assign to a local first to satisfy the null check, e.g.:

```ts
      const snap = secrets.getSnapshot()
      if (!snap) return
      const snapArr = Utils.toArray(snap, 'base64')
```

and line 423–424:

```ts
      if (directKeyMode && secrets.getSnapshot() && secrets.getKeyHex()) {
        const storedHex = secrets.getKeyHex()!.trim()
```

and line 540:

```ts
      this._snapshotLoaded = !!secrets.getSnapshot() && !!this._managers.walletManager
```

- [ ] **Step 4: Migrate the snapshot-write pages**

In each of these files, add (if not present) `import * as secrets from '<correct relative path>/lib/services/secrets'` and replace `localStorage.snap = saveEnhancedSnapshot()` with `secrets.setSnapshot(saveEnhancedSnapshot())`:
- `src/lib/navigation/Menu.tsx:269`
- `src/lib/pages/Greeter/index.tsx:717,769`
- `src/lib/pages/Recovery/LostPassword.tsx:102`
- `src/lib/pages/Recovery/RecoverPassword.tsx:143,166`
- `src/lib/pages/Recovery/LostPhone.tsx:69`
- `src/lib/pages/Recovery/RecoverPresentationKey.tsx:74`
- `src/lib/pages/Dashboard/Settings/Password/index.tsx:34`
- `src/lib/pages/Dashboard/Settings/RecoveryKey/index.tsx:57`

(Compute the relative path per file, e.g. from `src/lib/navigation/` it is `../services/secrets`; from `src/lib/pages/Recovery/` it is `../../services/secrets`.)

- [ ] **Step 5: Verify no secret left in localStorage**

Run: `grep -rn "localStorage\(\.\| *\.getItem(\| *\.setItem(\| *\.removeItem(\)['\"]*\(snap\|primaryKeyHex\|mnemonic12\)" src/`
Expected: no output (zero matches).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `2` (pre-existing baseline only).
Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: exit 0.

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run --config vitest.config.electron.ts`
Expected: all test files pass (including new `secretStore` and `secrets.renderer`).

- [ ] **Step 8: Commit**

```bash
git add src/main.tsx src/lib/utils/keyMaterial.ts src/lib/services/WalletService.ts src/lib/navigation/Menu.tsx src/lib/pages
git commit -m "feat(secrets): route all secret access through encrypted store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Renderer build verification + doc update

**Files:**
- Modify: `docs/SECURITY_REVIEW.md` (move #5 to remediated)

- [ ] **Step 1: Full renderer build**

Run: `npm run build:renderer`
Expected: build succeeds (the 2 baseline `WalletService.ts` type errors are emitted by `tsc` but, per current repo state, do not fail the build differently than before — if the build was green before this work, it must stay green; if `tsc` blocks the build, confirm only the 2 known baseline errors are present and unchanged).

- [ ] **Step 2: Electron build**

Run: `npm run build:electron`
Expected: succeeds (includes `secretStore.ts` compilation + the cp step).

- [ ] **Step 3: Update `docs/SECURITY_REVIEW.md`**

In the "Remediation Status" section, move #5 from "Still open" into "Patched":

```markdown
- **#5 Plaintext secrets at rest** — `snap`, `primaryKeyHex`, `mnemonic12` moved out of renderer `localStorage` into a main-process file encrypted with Electron `safeStorage` (key held in the OS keychain, not beside the data). Legacy plaintext is migrated and cleared on first launch. Falls back to a clearly-warned plaintext mode only when no OS keyring is available. Note: protects against other apps/users/backups/disk theft, not same-user malware on Win/Linux (passphrase upgrade tracked separately).
```

- [ ] **Step 4: Commit**

```bash
git add docs/SECURITY_REVIEW.md
git commit -m "docs: mark security review #5 (secrets at rest) remediated

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual verification checklist (post-implementation, run the app)

- Fresh install: log in, confirm `userData/secrets.dat` is created and contains `enc:true` entries; confirm `localStorage` has no `snap`/`primaryKeyHex`/`mnemonic12`.
- Upgrade path: start from a build/profile that has plaintext `localStorage.snap` (and direct-key `primaryKeyHex`/`mnemonic12`); launch, confirm values migrate into `secrets.dat` and are removed from `localStorage`, wallet still loads.
- Snapshot mutations (add/remove backup, change password/recovery) persist across restart.
- Linux without a keyring: confirm warning logged, `enc:false` entries written, login still works.
