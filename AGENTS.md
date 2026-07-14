# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**bsv-desktop** is an Electron-based desktop wallet for BSV blockchain built with React. It provides a complete wallet interface with support for both self-custody (local SQLite) and remote storage (WAB) modes. The project implements the BRC-100 wallet interface and exposes an HTTP server on port 3321 for external app integration.

**Architecture**: Electron (Node.js backend) + React (TypeScript frontend) + SQLite (local storage)

## Key Commands

### Development
```bash
npm run dev                  # Start dev server with hot reload
npm run dev:vite            # Start Vite only (port 5173)
npm run dev:electron        # Build Electron and launch
```

### Build
```bash
npm run build               # Build both renderer and Electron
npm run build:renderer      # Vite build → dist/
npm run build:electron      # TypeScript build → dist-electron/
```

### Packaging
```bash
npm run package             # Package for current platform
npm run package:mac         # macOS (DMG + ZIP)
npm run package:win         # Windows (NSIS + Portable)
npm run package:linux       # Linux (AppImage + DEB)
```

Output: `release/` directory

### Testing & Linting
```bash
npm run lint:ci             # Currently no-op
npm run test                # Currently no tests
```

## Architecture Overview

### Three-Process Architecture

**1. Electron Main Process** (`electron/`)
- Window lifecycle and IPC handlers (`main.ts`)
- HTTP server on port 3321 for BRC-100 interface (`httpServer.ts`)
- Storage manager with SQLite backend (`storage.ts`)
- Monitor worker process spawner (`storage.ts` → `monitor-worker.ts`)
- IPC security bridge (`preload.ts`)

**2. Renderer Process** (`src/`)
- React application entry (`main.tsx`)
- Wallet HTTP request handler (`onWalletReady.ts`)
- Native function wrappers (`electronFunctions.ts`)
- Storage IPC proxy (`StorageElectronIPC.ts`)

**3. Monitor Worker Process** (`electron/monitor-worker.ts`)
- Separate Node.js process for background tasks
- Runs `Monitor` from `@bsv/wallet-toolbox`
- Monitors transactions, proofs, UTXO state
- SQLite WAL mode for concurrent access

### Core Context System

The React app uses two primary contexts:

**1. WalletContext** ([src/lib/WalletContext.tsx](src/lib/WalletContext.tsx))
- **Wallet Managers**:
  - `WalletAuthenticationManager` (WAB mode with phone/DevConsole auth)
  - `CWIStyleWalletManager` (self-custody mode)
  - Both create `WalletPermissionsManager` for permission handling
- **Permission Queues**: basket, certificate, protocol, spending, grouped
- **Group Permission Gating**: Batches related permission requests
- **Configuration**: Network (main/test), WAB URL, storage URL, auth method
- **Snapshot Management**: Version 3 format with config persistence

**2. UserContext** ([src/lib/UserContext.tsx](src/lib/UserContext.tsx))
- Platform-agnostic native handlers (focus, download, dialogs)
- Modal visibility state for permission handlers
- App metadata (version, name)

### Wallet Initialization Flow

**New Users**:
1. `WalletConfig` component shows → user selects network, auth, storage
2. `finalizeConfig()` validates and stores config in WalletContext state
3. Wallet manager created based on `useWab` flag
4. User provides password → `providePassword()` → authenticated
5. Snapshot saved to `localStorage.snap` (Version 3 format)

**Returning Users**:
1. Snapshot detected in localStorage
2. Config restored **before** wallet manager creation (critical for preventing duplicates)
3. Wallet manager created with restored config
4. Snapshot loaded into wallet manager
5. User authenticated automatically

### Snapshot Format (Version 3)

```
[version byte: 3]
[varint: config_length]
[config JSON bytes]
[wallet snapshot bytes from WalletManager]
```

**Config includes**: `wabUrl`, `network`, `storageUrl`, `messageBoxUrl`, `authMethod`, `useWab`, `useRemoteStorage`, `useMessageBox`

**Critical Implementation**:
- Config restoration happens in **early useEffect** (before wallet manager creation)
- Prevents cascading state updates and duplicate wallet managers
- Backward compatible with Version 1/2 snapshots
- Saved on: authentication, password change, profile switch, logout

### Storage Architecture

**Local Storage** (`useRemoteStorage: false`):
```
Renderer (WalletContext)
  ↓ buildWallet()
StorageElectronIPC (IPC wrapper)
  ↓ electron.storage.callMethod()
Main Process (storage.ts)
  ↓ StorageManager.callMethod()
StorageKnex
  ↓ Knex queries
SQLite (~/.bsv-desktop/wallet-<identityKeyHex>-main.db)
```

**Remote Storage** (`useRemoteStorage: true`):
```
Renderer (WalletContext)
  ↓ buildWallet()
StorageClient (HTTP)
  ↓ Fetch requests
Remote Storage Server
```

**Storage Manager** (`electron/storage.ts`):
- Maintains Map of storage instances by `identityKey-chain`
- IPC handlers: `isAvailable`, `makeAvailable`, `callMethod`, `initializeServices`
- Spawns Monitor worker per identity/chain
- SQLite WAL mode enabled for concurrent access

### Permission Request Flow

1. **Request Reception**: External app calls BRC-100 method → permission needed
2. **Callback Invoked**: `WalletPermissionsManager` calls bound callback (e.g., `basketAccessCallback`)
3. **Queueing**: Request added to type-specific queue in WalletContext
4. **Modal Display**: Handler component (e.g., `BasketAccessHandler`) shows modal for first queued item
5. **User Decision**: User approves/denies → calls permission manager method
6. **Queue Advancement**: `advance*Queue()` removes handled request, shows next

**Group Permissions**:
- `groupPhase` state: 'idle' | 'pending'
- Individual requests buffered when grouped request arrives
- After grouped decision, buffered requests evaluated against decision
- Uncovered requests re-queued for individual approval

### HTTP Server (BRC-100 Interface)

**Flow** (`electron/httpServer.ts`):
1. External app → `POST http://127.0.0.1:3321/createAction`
2. Express server receives request
3. Main process → IPC `http-request` → Renderer
4. Renderer's `onWalletReady` handler → `WalletInterface` method
5. Renderer → IPC `http-response` → Main process
6. Main process returns HTTP response to external app

**CORS**: Enabled for all origins

### Monitor Worker Process

**Lifecycle**:
```
Main Process (storage.ts)
  ↓ fork('monitor-worker.js')
Worker Process (monitor-worker.ts)
  ↓ sends 'ready' message
Main Process
  ↓ sends 'start' with {identityKey, chain}
Worker Process
  ↓ creates DB connection (WAL mode)
  ↓ creates Monitor
  ↓ startTasks()
  ↓ sends 'monitor-started'
[Background monitoring runs]
Main Process (on shutdown)
  ↓ sends 'stop'
Worker Process
  ↓ stopTasks()
  ↓ exit
```

**Why Separate Process**:
- Prevents blocking main thread during `Monitor.startTasks()`
- Isolates errors (worker crash doesn't affect app)
- Concurrent SQLite access via WAL mode

## Important Implementation Patterns

### Preventing Duplicate Wallet Managers

**Problem**: Config restoration during snapshot load triggers re-renders → duplicate wallet managers

**Solution**:
1. Early useEffect restores config **before** wallet manager creation useEffect
2. Only depends on `loadEnhancedSnapshot`, runs once on mount
3. Sets `configStatus: 'configured'` to prevent second useEffect from re-running
4. Wallet manager useEffect checks `configStatus !== 'editing'`

### Ensuring useRemoteStorage is Saved

**Problem**: `useRemoteStorage` wasn't being saved to snapshots or set during config finalization

**Solution**:
1. `finalizeConfig()` calls `setUseRemoteStorage()` and `setUseMessageBox()`
2. `saveEnhancedSnapshot()` includes these flags in config JSON
3. `loadEnhancedSnapshot()` infers `useRemoteStorage` from `storageUrl` if not explicitly set (backward compatibility)

### SQLite Concurrent Access

**Problem**: Renderer and Monitor both accessing database caused locks

**Solution**:
1. Enable SQLite WAL (Write-Ahead Logging) mode
2. Monitor runs in separate process with own connection
3. Both can read/write without blocking

### Focus Management

- Permission requests call `onFocusRequested()` to bring app to foreground
- `onFocusRelinquished()` called when queues empty
- Platform-specific implementations in `electron/main.ts`

### Recent Apps Tracking

- `RequestInterceptorWallet` wraps wallet interface
- Intercepts method calls to record originator domain
- `updateRecentApp()` fetches favicon/manifest
- Debounced (5s) to prevent duplicate tracking
- Stored in localStorage as `brc100_recent_apps_{profileId}`

## Component Structure

**Permission Handlers** (in `src/lib/components/`):
- `BasketAccessHandler`, `CertificateAccessHandler`, `ProtocolPermissionHandler`
- `GroupPermissionHandler`, `SpendingAuthorizationHandler`
- Modal-based UI with approve/deny actions

**Dashboard Pages** (in `src/lib/pages/Dashboard/`):
- `/dashboard` - Apps, recent actions, balance
- `/dashboard/apps` - App catalog
- `/dashboard/my-identity` - Identity certificates
- `/dashboard/trust` - Trusted entities
- `/dashboard/settings` - Password, recovery key

**UI Components**:
- `UserInterface` - Main router with permission handlers
- `WalletConfig` - WAB/storage/network configuration
- `AmountDisplay` - Currency display with exchange rates
- Chips: `AppChip`, `BasketChip`, `CertificateChip`, etc.

## Working with Code

### Adding New Permission Types

1. Add queue state to `WalletContext`: `const [newRequests, setNewRequests] = useState<NewRequest[]>([])`
2. Create callback: `const newCallback = useCallback((request) => { setNewRequests(q => [...q, request]) }, [])`
3. Bind in `buildWallet()`: `permissionsManager.bindCallback('newPermission', newCallback)`
4. Create advance function: `const advanceNewQueue = () => { setNewRequests(q => q.slice(1)) }`
5. Create handler component: `NewPermissionHandler.tsx`
6. Add to `UserInterface.tsx` with modal visibility state

### Storage Backend Changes

**Local (Electron)**:
- Modify `electron/storage.ts` for IPC handlers
- Update `src/StorageElectronIPC.ts` for proxy methods
- Database files at `~/.bsv-desktop/wallet-<identityKeyHex>-main.db` (mainnet) or `…-test.db` (testnet). One file per identity key; the bare `wallet.db` is legacy and empty on new installs.

**Remote (WAB)**:
- Uses `StorageClient` from `@bsv/wallet-toolbox`
- Configure via `WalletConfig` component

### Configuration Changes

- Defaults in `src/lib/config.ts`
- User config via `WalletConfig` component
- Finalized by `finalizeConfig()` in WalletContext
- Stored in snapshot (Version 3)

### TypeScript

- `strict: false` - existing code not fully type-safe
- Renderer: `tsconfig.json` → `dist/` + `dist/types/`
- Electron: `tsconfig.electron.json` → `dist-electron/`
- Shared types in `src/global.d.ts`

## Key Dependencies

- `@bsv/wallet-toolbox` - Wallet managers, storage, permissions, Monitor
- `@bsv/sdk` - Transactions, keys, signing
- `electron` - Desktop framework
- `express` - HTTP server (port 3321)
- `better-sqlite3` + `knex` - Local SQLite storage
- `react` + `react-router-dom` v5 - UI framework
- `@mui/material` - Material-UI components

## Development Notes

### File Locations

- **React UI library**: `src/lib/` (reusable components, contexts, pages)
- **Electron app entry**: `src/` (main.tsx, onWalletReady.ts, electronFunctions.ts)
- **Electron backend**: `electron/` (main.ts, httpServer.ts, storage.ts, monitor-worker.ts)
- **Build output**: `dist/` (renderer), `dist-electron/` (main), `release/` (packaged apps)

### Testing HTTP Server

```bash
# Check if authenticated
curl http://127.0.0.1:3321/isAuthenticated

# Test wallet method
curl -X POST http://127.0.0.1:3321/listOutputs \
  -H "Content-Type: application/json" \
  -d '{"args": [{"basket": "default"}]}'
```

### Debugging

- **Main process**: Logs in terminal where `npm run dev` runs
- **Renderer**: DevTools auto-open in dev mode (Cmd+Opt+I / Ctrl+Shift+I)
- **Monitor worker**: stdout/stderr piped to main process console

### Database

- Per-identity files: `~/.bsv-desktop/wallet-<identityKeyHex>-main.db` (mainnet) or `…-test.db` (testnet). To find your active DB, grep the wallet log for `identityKey: …`, then match the hex prefix.
- WAL mode files: `<wallet-file>-wal`, `<wallet-file>-shm`
- Delete database: `rm -rf ~/.bsv-desktop/` (forces re-initialization)

## Common Patterns

### useEffect Dependencies in WalletContext

- Config restoration: Only `loadEnhancedSnapshot`
- Wallet manager creation: All config state + `passwordRetriever` + `recoveryKeySaver`
- Snapshot loading: Happens inside wallet manager creation (async/await)

### IPC Communication

**Renderer → Main**:
```typescript
const result = await window.electron.storage.callMethod(identityKey, chain, 'listOutputs', [args])
```

**Main → Renderer** (HTTP requests):
```typescript
mainWindow.webContents.send('http-request', { id, method, args })
ipcMain.once(`http-response-${id}`, (event, response) => { /* ... */ })
```

### Error Handling

- Toast errors via `react-toastify`
- Console errors for debugging
- Try/catch in async wallet operations
- Permission callbacks should not throw (breaks wallet flow)
