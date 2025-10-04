# Tauri to Electron Migration

This document chronicles the migration of BSV Desktop from Tauri (Rust backend) to Electron (Node.js backend).

## Why We Migrated

The original BSV Desktop was built with Tauri, which used a Rust backend for native functionality. While Tauri provided excellent performance and small bundle sizes, we needed to introduce **local database storage** as an option alongside remote storage.

The `@bsv/wallet-toolbox` library provides SQLite-based storage through `StorageKnex`, which uses:
- `knex` - SQL query builder (Node.js)
- `better-sqlite3` - Native SQLite bindings (Node.js)

### The Challenge

These dependencies are Node.js-native and cannot run in a Rust/Tauri environment. We had two options:

1. **Rewrite storage layer in Rust** - Implement a custom SQLite solution in Rust that mirrors `StorageKnex` behavior
2. **Switch to Electron** - Use Node.js backend to directly leverage existing `@bsv/wallet-toolbox` storage

We chose Electron to:
- ✅ Reuse existing, battle-tested storage code from `@bsv/wallet-toolbox`
- ✅ Avoid maintaining parallel Rust/Node.js storage implementations
- ✅ Simplify development (TypeScript-only instead of Rust + TypeScript)
- ✅ Enable future Node.js integrations (Monitor, daemon processes, etc.)

## Migration Journey

### Phase 1: Core Electron Setup
**Goal**: Replace Tauri with Electron while maintaining feature parity

**Completed**:
- ✅ Electron main process with window management
- ✅ IPC communication (replacing Tauri events)
- ✅ HTTP server on port 3321 (Express replacing Hyper)
- ✅ Native handlers (focus, download, file dialogs)
- ✅ Build/packaging scripts (electron-builder replacing Tauri bundler)

**Key Changes**:
- `electron/main.ts` - Window lifecycle, IPC handlers
- `electron/httpServer.ts` - BRC-100 interface server
- `electron/preload.ts` - Secure IPC bridge
- `src/electronFunctions.ts` - Native handlers for React

### Phase 2: Local Storage Integration
**Goal**: Enable SQLite-based local storage using `StorageKnex`

**Completed**:
- ✅ Local storage via `StorageKnex` + `better-sqlite3`
- ✅ Database location: `~/.bsv-desktop/wallet.db` (or `wallet-test.db`)
- ✅ Dual storage mode: local (Electron) or remote (StorageClient)
- ✅ Storage backend abstraction (`electron/storage.ts`)
- ✅ IPC-based storage proxy (`src/lib/StorageElectronIPC.ts`)

**Architecture**:
```
Renderer Process (React)
    ↓ IPC call
Main Process (Electron)
    ↓ Direct method call
StorageKnex (Node.js)
    ↓ SQL queries
SQLite Database (~/.bsv-desktop/wallet.db)
```

**Key Implementation**:
- `electron/storage.ts` - Storage manager, maintains storage instances per identity
- `src/lib/StorageElectronIPC.ts` - IPC wrapper implementing BRC-100 storage interface
- `src/lib/WalletContext.tsx` - Conditionally uses local or remote storage based on config

### Phase 3: Enhanced Snapshot Management (Version 3)
**Goal**: Persist wallet configuration across sessions

**Problem**: Users had to reconfigure WAB/storage settings on every app restart

**Solution**: Extended snapshot format to include configuration metadata

**Snapshot Format Evolution**:
```
Version 1/2 (Legacy):
  [wallet snapshot bytes...]

Version 3 (Enhanced):
  [version byte: 3]
  [varint: config_length]
  [config JSON: {wabUrl, network, storageUrl, useWab, useRemoteStorage, ...}]
  [wallet snapshot bytes...]
```

**Implementation**:
- Varint encoding for compact config size representation
- Backward compatibility with Version 1/2 snapshots
- Config restoration happens **before** wallet manager creation to prevent race conditions
- Saved on authentication, password change, profile switch

**Key Files**:
- `src/lib/WalletContext.tsx`: `saveEnhancedSnapshot()`, `loadEnhancedSnapshot()`
- Config fields: `wabUrl`, `network`, `storageUrl`, `messageBoxUrl`, `authMethod`, `useWab`, `useRemoteStorage`, `useMessageBox`

### Phase 4: Background Monitoring (Separate Process)
**Goal**: Run wallet monitoring tasks without blocking the UI

**Challenge**: `Monitor` from `@bsv/wallet-toolbox` needs to continuously check for:
- New transactions
- Merkle proof updates
- UTXO state changes

Running Monitor in the main thread caused initialization hangs and UI freezes.

**Solution**: Separate worker process for Monitor

**Implementation**:
- `electron/monitor-worker.ts` - Standalone Node.js process
- Runs `Monitor.startTasks()` in isolation
- IPC communication for start/stop commands
- Separate database connection with SQLite WAL mode (Write-Ahead Logging)
- Graceful shutdown handling

**Worker Lifecycle**:
```
Main Process                     Monitor Worker
     |                                  |
     |-- fork(monitor-worker.js) ----->|
     |                                  |-- wait for 'ready'
     |<------------ ready --------------|
     |                                  |
     |-- start {identityKey, chain} --->|
     |                                  |-- create DB connection
     |                                  |-- create Monitor
     |                                  |-- startTasks()
     |<------- monitor-started ---------|
     |                                  |
     |  [Monitor runs in background]    |
     |                                  |
     |-- stop ------------------------->|
     |                                  |-- stopTasks()
     |<------- monitor-stopped ---------|
     |                                  |-- exit
```

**Concurrency**: SQLite WAL mode enables renderer and worker to access the same database simultaneously without locking.

**Key Files**:
- `electron/monitor-worker.ts` - Worker process implementation
- `electron/storage.ts` - Worker spawning and lifecycle management
- Uses Node.js `child_process.fork()` for process isolation

## Technical Comparison

| Aspect | Tauri (Rust) | Electron (Node.js) |
|--------|--------------|-------------------|
| **Backend Language** | Rust | TypeScript/JavaScript |
| **HTTP Server** | Hyper (Rust) | Express (Node.js) |
| **IPC** | Tauri Events | Electron IPC |
| **Storage** | ❌ No native support | ✅ StorageKnex + better-sqlite3 |
| **Monitor** | ❌ Complex integration | ✅ Worker process |
| **Bundle Size** | ~10-15MB | ~80-100MB |
| **Startup Time** | Faster | Slightly slower |
| **Development** | Rust + TypeScript | TypeScript only |
| **Toolbox Compatibility** | Partial | Full |

## Key Challenges & Solutions

### Challenge 1: Database Locking
**Problem**: Renderer and Monitor both accessing SQLite caused locks and hangs

**Solution**:
- Enabled SQLite WAL (Write-Ahead Logging) mode
- Separate worker process for Monitor with its own connection
- Concurrent read/write without blocking

### Challenge 2: Duplicate Wallet Manager Creation
**Problem**: Config restoration during snapshot load triggered re-renders and duplicate wallet managers

**Solution**:
- Separated config restoration into early `useEffect`
- Config restored **before** wallet manager creation useEffect runs
- Prevented cascading state updates

### Challenge 3: Missing Config in Snapshots
**Problem**: `useRemoteStorage` and `useMessageBox` flags weren't being saved to snapshots

**Solution**:
- Added `setUseRemoteStorage()` and `setUseMessageBox()` calls in `finalizeConfig()`
- Inference logic: if `useRemoteStorage` undefined but `storageUrl` exists → infer `true`
- Ensures backward compatibility with older snapshots

### Challenge 4: Monitor Blocking Initialization
**Problem**: `WalletStorageManager.addWalletStorageProvider()` blocked main thread

**Solution**:
- Moved Monitor to separate worker process
- Non-blocking initialization
- Error isolation (worker crashes don't affect main app)

## Migration Benefits

### For Users
- 🎯 **Persistent configuration** - Settings remembered across sessions
- 💾 **Local storage option** - No remote server required
- ⚡ **Better performance** - Background monitoring doesn't freeze UI
- 🔒 **Self-custody mode** - Full local control of wallet data

### For Developers
- 🛠️ **Single language** - TypeScript throughout (no Rust required)
- 📦 **Full toolbox support** - Direct access to all `@bsv/wallet-toolbox` features
- 🔧 **Easier debugging** - Node.js debugging tools vs Rust toolchain
- 🚀 **Faster iteration** - No Rust compilation step

## Future Enhancements

With the Node.js backend, we can now easily add:

- ✨ **Enhanced Monitor** - More sophisticated background tasks
- 🔄 **Auto-sync** - Periodic wallet state synchronization
- 📊 **Analytics** - Local usage tracking and reporting
- 🔌 **Plugin system** - Third-party storage/service providers
- 🌐 **P2P features** - Direct peer connections for messaging/payments

## Lessons Learned

1. **Choose runtime based on dependencies** - If your core dependencies are Node.js-native, Electron is the natural choice
2. **Separate concerns** - Long-running tasks belong in worker processes
3. **Snapshot everything** - User configuration is as important as wallet state
4. **WAL mode is essential** - For concurrent SQLite access across processes
5. **State management matters** - React state updates can cascade in unexpected ways

## Conclusion

The migration to Electron was driven by the need for local database storage. While we traded some bundle size and startup performance, we gained:

- Full compatibility with `@bsv/wallet-toolbox`
- Simplified development (TypeScript-only)
- Better architecture for background tasks
- Foundation for future Node.js-based features

The result is a more maintainable, extensible desktop wallet that gives users the choice between remote and local storage while providing a smooth, non-blocking user experience.
