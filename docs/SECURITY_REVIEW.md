# Security and Performance Review

**Project**: bsv-desktop (Electron + React desktop wallet for BSV)  
**Review Date**: 2026-06-18  
**Scope**: Static analysis of source code for security and performance issues

> This document captures findings from a code review focused on security and performance risks. It is not a substitute for a professional audit, dynamic testing, or penetration testing.

---

## Remediation Status (2026-06-18)

Patched in this pass (non-breaking hardening):

- **#2 Command injection** — `sslCert.ts` and `main.ts` now use `execFile` with argument arrays instead of shell-interpolated `exec`. The remaining `osascript ... with administrator privileges` call (which must run a shell string) JSON-quotes the path, and the restored bundle identifier is validated against `^[A-Za-z0-9.\-]+$`.
- **#3 Arbitrary storage dispatch** — `callStorageMethod` now rejects any method not in an explicit allow-list (`ALLOWED_STORAGE_METHODS` in `electron/storage.ts`), kept in sync with `StorageElectronIPC`.
- **#4 XSS in release notes** — release notes are sanitized with `DOMPurify` before `dangerouslySetInnerHTML`.
- **#6 / #10 Navigation controls** — `setWindowOpenHandler` / `will-navigate` / `will-redirect` now allow only `http:`/`https:` to reach `shell.openExternal`; `javascript:`, `file:`, `data:` and custom protocols are blocked, and `will-redirect` is handled.
- **#9 Manifest proxy redirects** — the resolved URL after redirects is re-validated for HTTPS + `/manifest.json`.
- **#5 Plaintext secrets at rest** — `snap`, `primaryKeyHex`, and `mnemonic12` were moved out of renderer `localStorage` into a main-process file (`userData/secrets.dat`) encrypted with Electron `safeStorage` (key held in the OS keychain — macOS Keychain / Windows DPAPI / Linux libsecret/kwallet — not beside the data). The toolbox "encrypted" snapshot offered no at-rest protection because it stores its AES key inside the same blob. Legacy plaintext is migrated and cleared on first launch; `logout()` clears the store. Falls back to a clearly-warned plaintext mode only when no OS keyring is available (`secretStore.ts` / renderer `secrets.ts`). Limit: protects against other apps/users, backups, and disk theft — **not** same-user malware on Windows/Linux (per-user keys). The passphrase upgrade is tracked separately.

Still open (require larger / potentially breaking changes — tracked, not yet done):

- **#1 Unauthenticated local HTTP server** — intentionally open to local browser clients (the BRC-100 model). The per-origin permission prompt is the security boundary; transport auth can't distinguish a browser from a local process without breaking the web use case. Hardening tracked: ensure all read methods are permissioned; optional burst rate limiting.
- **#7 `sandbox: false` / dev web-security disabled**, **#8 `removeAllListeners`**, **#11–#16 performance/robustness** — see below.

---

## Critical Security Issues

### 1. Unauthenticated Local HTTP Server (BRC-100 Interface) — Highest Risk

**Files**:
- [electron/httpServer.ts](../electron/httpServer.ts)
- [src/onWalletReady.ts](../src/onWalletReady.ts)

**Details**:
- The server listens on `127.0.0.1:3321` (HTTP) and `2121` (HTTPS) with **no authentication** at the transport layer.
- `app.all('*', ...)` forwards every request to the renderer.
- CORS is fully permissive:
  ```js
  app.use(cors({
    origin: '*',
    methods: '*',
    allowedHeaders: '*',
    exposedHeaders: '*',
    credentials: false,
    preflightContinue: true
  }));
  ```
- Body size limit: `50mb` for both JSON and text.
- Origin is parsed in the renderer from `origin` or `originator` headers and passed as the `originator` parameter to wallet methods. This value is easily spoofed by non-browser local clients (any process on the machine).
- **Impact**: Any local process (malware, another app, browser extension exploiting a localhost origin, etc.) can invoke `createAction`, `signAction`, `internalizeAction`, `listOutputs`, etc. The in-app permission prompts are the only remaining control — and they are not mandatory for all operations or configurations.

### 2. Command Injection via `exec`

**Files**:
- [electron/sslCert.ts](../electron/sslCert.ts) (lines ~140, 209, 213)
- [electron/main.ts](../electron/main.ts) (focus handling, lines ~156, 222)

**Examples**:
```js
// sslCert.ts
await execAsync(`security verify-cert -c "${certPath}" -p ssl -s localhost`);
await execAsync(`security add-trusted-cert -d -r trustRoot -k ... "${certPath}"`);
await execAsync(`osascript -e 'do shell script "security ... \\"${certPath}\\" ..." with administrator privileges'`);
```

```js
// main.ts (macOS focus)
await execPromise(`osascript -e 'tell application "System Events" to get the bundle identifier ...'`);
await execPromise(`osascript -e 'tell application "System Events" to set frontmost of ... "${target}" ...'`);
```

- `certPath` is derived from user data directory but is directly interpolated.
- `prevBundleId` and `target` come from prior `exec` stdout without sanitization.
- Shell metacharacters are not escaped.

### 3. Arbitrary Method Dispatch on Storage Backend

**Files**:
- [electron/main.ts](../electron/main.ts) (IPC handler at ~419)
- [electron/storage.ts](../electron/storage.ts) (`callStorageMethod`)

**Details**:
```ts
ipcMain.handle('storage:call-method', async (_event, identityKey, chain, method, args) => {
  ...
  const result = await storageAny[method](...args);
});
```

The renderer can invoke **any** method on the `StorageKnex` instance with arbitrary arguments via IPC. A compromised renderer process (XSS, malicious third-party code, supply-chain compromise in `@bsv/*` packages) gains full control over the wallet database.

### 4. XSS via `dangerouslySetInnerHTML` on Update Release Notes

**File**: [src/lib/components/UpdateNotification.tsx](../src/lib/components/UpdateNotification.tsx) (~191)

```tsx
<div dangerouslySetInnerHTML={{ __html: updateInfo.releaseNotes }} />
```

`releaseNotes` is populated from:
- `electron-updater` update metadata.
- In dev mode, directly from `https://api.github.com/repos/bsv-blockchain/bsv-desktop/releases/latest` (body field).

No sanitization is applied.

### 5. Sensitive Data Stored in Plaintext in localStorage

- `localStorage.snap` (Version 3) contains the full wallet snapshot (including key material) encoded as base64. See [src/lib/services/WalletService.ts](../src/lib/services/WalletService.ts) (~630, ~664).
- In direct-key mode, `primaryKeyHex` and `mnemonic12` are also stored in localStorage.
- Renderer `localStorage` is accessible to any script executing in the renderer context.

---

## High / Medium Security Issues

### 6. Weak Navigation and `shell.openExternal` Controls

**File**: [electron/main.ts](../electron/main.ts) (111–130)

- `setWindowOpenHandler` and `will-navigate` only test for `http://` or `https://` prefixes.
- No protection against `javascript:`, `file:`, `data:`, or custom protocol handlers.
- `will-redirect` event is **not** handled.

### 7. `sandbox: false` + Dev-Mode Web Security Disabled

**File**: [electron/main.ts](../electron/main.ts) (~84–88, 491–496)

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false
}
if (isDev) {
  '--disable-web-security',
  '--ignore-certificate-errors'
}
```

### 8. Overly Broad `removeAllListeners`

**File**: [electron/preload.ts](../electron/preload.ts) (32–34, 66–71)

- `removeHttpRequestListener()` does `ipcRenderer.removeAllListeners('http-request')`.
- Similar pattern for all update channels.
- Calling this (or having compromised code call it) can globally disable HTTP request handling or update notifications.

### 9. Proxy Manifest Fetch Allows Redirects to Arbitrary Final Hosts

**File**: [electron/main.ts](../electron/main.ts) (~346–384)

- Input URL is validated to be `https` and end in `/manifest.json`.
- Then `node-fetch` is called with `redirect: 'follow'`.
- The final response body/headers are returned without validating the *resolved* URL.

### 10. Missing `will-redirect` Handler

Leaves a small bypass opportunity for navigation controls.

---

## Performance and Robustness Issues

### 11. Permanent Listeners with No Cleanup

- `onWalletReady.ts` registers the HTTP IPC listener once (module-level flag) with the comment "No cleanup — listener is permanent".
- Multiple `useEffect` hooks lack cleanup functions.
- `ipcRenderer.on(...)` registrations in preload are not removed on window lifecycle events in a scoped manner.

### 12. Lack of Rate Limiting or Guards on the Local HTTP Server

- 50 MB body limit with no per-origin, per-client, or global rate limiting.
- Every call is fully deserialized and dispatched in the renderer.
- No concurrency or backpressure controls for external BRC-100 callers.

### 13. Storage Instantiation and Connection Patterns

`getOrCreateStorage` is called from several IPC paths. While a Map cache exists, multiple entry points (makeAvailable, initializeServices, callMethod) can trigger creation and migration under load.

### 14. Concurrent Database Access (Monitor Worker + Main)

Both the main process and the monitor worker hold database connections to the same SQLite files (WAL mode helps but does not eliminate all contention risks during heavy sync or monitor activity).

### 15. Full Snapshot Loading on Startup and Recovery Paths

The entire wallet snapshot is loaded from `localStorage` (base64) synchronously during several flows. No streaming or size guards.

### 16. HTTP Response Listener Tied to Specific Window Instance

In [electron/httpServer.ts](../electron/httpServer.ts) (~89), responses are listened for via:

```ts
mainWindow.webContents.on('ipc-message', ...)
```

If the main window is closed and recreated, the listener is orphaned and new responses may be dropped.

---

## Other Notable Items

- Exported mnemonic/private key files use `chmod 0o400` but are written with predictable timestamped names into `~/.bsv-desktop/`.
- `fetchAppData` and manifest parsing make network requests to arbitrary third-party domains (recent apps, user data) with limited timeout enforcement in some paths.
- `ADMIN_ORIGINATOR = 'admin.com'` is used for internal privileged operations. While external callers should not be able to claim it, it is a well-known string.

---

## Recommendations (Prioritized)

### Must Fix (high value target — real funds at risk)

1. **Add authentication or strong gating** to the localhost HTTP API (3321/2121). Consider a capability token, mutual auth, or binding to a Unix domain socket instead of TCP.
2. Do **not** rely solely on the spoofable `originator` header for high-value actions. Keep or strengthen user approval requirements.
3. Eliminate or harden all `exec` / shell interpolation for certificate paths and bundle identifiers. Prefer non-shell `child_process` APIs.
4. Remove or sanitize `dangerouslySetInnerHTML` usage for release notes. Use a restricted Markdown renderer.
5. Protect the wallet snapshot and key material at rest (encrypt the snapshot, avoid plaintext `localStorage` for secrets where possible).
6. Add `will-redirect` handling and tighten `shell.openExternal` controls.

### Strongly Recommended

- Add rate limiting and reduce body size limits on the BRC-100 HTTP server.
- Replace or restrict the raw `storage:call-method` IPC (use an explicit allow-list of permitted operations).
- Ship a Content Security Policy in production builds.
- Re-evaluate `sandbox: false`. Enable if native module constraints can be resolved.
- Ensure every `ipcRenderer.on` has a matching removal and avoid blanket `removeAllListeners`.
- Validate the final URL after redirects in the manifest proxy.

### Performance / Robustness

- Add debouncing/throttling for recent apps tracking and app metadata fetches.
- Audit all `useEffect` for missing cleanup.
- Introduce backpressure or bounded concurrency for the HTTP → renderer dispatch path.
- Clarify DB connection ownership between monitor worker and main process.
- Consider incremental/safe snapshot handling for very large wallets.

---

## Disclaimer

This review is based on static source analysis. It should be followed by:

- Dynamic testing / fuzzing of the HTTP interface from local processes.
- Supply-chain analysis of the `@bsv/sdk`, `@bsv/wallet-toolbox`, and related packages.
- Professional security audit and penetration testing before handling significant value.

---

*End of review*
