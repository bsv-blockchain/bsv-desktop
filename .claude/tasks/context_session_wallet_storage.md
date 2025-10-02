# BSV Desktop Wallet Storage Implementation

## Task Completed
Implemented proper wallet storage architecture for BSV Desktop Electron application using IPC communication between renderer and main processes.

## Problem Statement
The application was incorrectly attempting to use `StorageKnex` (which requires Node.js modules like `better-sqlite3` and `knex`) directly in the React frontend (renderer process). This won't work because:

1. Node.js native modules don't work in browser/renderer context
2. Direct `require()` calls in React components violate Electron's security model
3. Database operations should be centralized in the main process for proper resource management

## Solution Architecture

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (Renderer Process)                            │
│  - src/lib/StorageElectronIPC.ts                       │
│  - Implements WalletStorageProvider interface          │
│  - Delegates to IPC                                     │
└─────────────────────────────────────────────────────────┘
                         │
                         │ IPC Communication
                         │
┌─────────────────────────────────────────────────────────┐
│  IPC Bridge                                              │
│  - electron/preload.ts: Exposes window.electronAPI      │
│  - electron/main.ts: Handles IPC requests               │
└─────────────────────────────────────────────────────────┘
                         │
                         │
┌─────────────────────────────────────────────────────────┐
│  Backend (Main Process)                                  │
│  - electron/storage.ts                                  │
│  - Manages StorageKnex instances                        │
│  - Handles database connections                         │
│  - Database: ~/.bsv-desktop/wallet.db                  │
└─────────────────────────────────────────────────────────┘
```

## Files Created/Modified

### 1. Backend Storage Handler
**File:** `/Users/personal/git/bsv-desktop/electron/storage.ts` (NEW)

**Purpose:** Manages StorageKnex instances in the main process

**Key Features:**
- Singleton `StorageManager` class
- Maintains separate storage instances per identity key and chain
- Database files:
  - Mainnet: `~/.bsv-desktop/wallet.db`
  - Testnet: `~/.bsv-desktop/wallet-test.db`
- Uses `better-sqlite3` for local SQLite storage
- Proper cleanup on app shutdown

**Key Methods:**
- `getOrCreateStorage(identityKey, chain)` - Get/create storage instance
- `isAvailable(identityKey, chain)` - Check storage availability
- `makeAvailable(identityKey, chain)` - Initialize database tables
- `callStorageMethod(identityKey, chain, method, args)` - Proxy method calls
- `cleanup()` - Cleanup all connections

### 2. IPC Handlers
**File:** `/Users/personal/git/bsv-desktop/electron/main.ts` (MODIFIED)

**Changes:**
- Added import: `import { storageManager } from './storage.js'`
- Added three IPC handlers:
  - `storage:is-available` - Check if storage can be made available
  - `storage:make-available` - Initialize storage
  - `storage:call-method` - Call any storage method
- Added cleanup calls in `window-all-closed` and `before-quit` events

### 3. Preload API
**File:** `/Users/personal/git/bsv-desktop/electron/preload.ts` (MODIFIED)

**Changes:**
- Added `storage` namespace to `window.electronAPI`:
  ```typescript
  storage: {
    isAvailable: (identityKey, chain) => Promise<boolean>
    makeAvailable: (identityKey, chain) => Promise<{success, error?}>
    callMethod: (identityKey, chain, method, args) => Promise<{success, result?, error?}>
  }
  ```
- Updated TypeScript types in `ElectronAPI` interface

### 4. Frontend Storage Wrapper
**File:** `/Users/personal/git/bsv-desktop/src/lib/StorageElectronIPC.ts` (NEW)

**Purpose:** Implements `WalletStorageProvider` interface using IPC

**Key Features:**
- Implements all required `WalletStorageProvider` methods
- Each method delegates to main process via IPC
- Type-safe communication with error handling
- Logging for debugging

**Architecture Notes:**
```typescript
// Example method delegation:
async insertCertificate(...args: any[]): Promise<any> {
  return this.callMethod('insertCertificate', ...args);
}

// Generic IPC call:
private async callMethod<T>(method: string, ...args: any[]): Promise<T> {
  const result = await window.electronAPI.storage.callMethod(
    this.identityKey,
    this.chain,
    method,
    args
  );

  if (!result.success) {
    throw new Error(`Storage method ${method} failed: ${result.error}`);
  }

  return result.result as T;
}
```

### 5. Wallet Context Update
**File:** `/Users/personal/git/bsv-desktop/src/lib/WalletContext.tsx` (MODIFIED)

**Changes:**
- Removed import: `StorageKnex`
- Added import: `StorageElectronIPC`
- Replaced local storage implementation (lines 835-839):

**Before:**
```typescript
const os = require('os');
const path = require('path');
const fs = require('fs');
const knex = require('knex');

const homeDir = os.homedir();
const bsvDir = path.join(homeDir, '.bsv-desktop');

// ... 20+ lines of knex/sqlite setup ...

const localStorage = new StorageKnex({ ... });
await storageManager.addWalletStorageProvider(localStorage);
```

**After:**
```typescript
// Use local Electron IPC storage (StorageKnex running in main process)
const electronStorage = new StorageElectronIPC(keyDeriver.identityKey, chain);
await electronStorage.makeAvailable();
await storageManager.addWalletStorageProvider(electronStorage);
```

## Why IPC Instead of StorageClient?

### StorageClient Approach (Not Used)
- Designed for **remote HTTP storage servers**
- Would require running HTTP server in main process
- Communication via HTTP/WebSocket
- Unnecessary overhead for local storage

### IPC Approach (Implemented)
- Native Electron communication pattern
- Direct method invocation between processes
- More efficient for local operations
- Simpler architecture for desktop apps
- Better error handling and debugging

## Database Location

- **Mainnet:** `~/.bsv-desktop/wallet.db`
- **Testnet:** `~/.bsv-desktop/wallet-test.db`

The directory is created automatically if it doesn't exist.

## Testing Recommendations

1. **Basic Storage Operations:**
   - Create a new wallet
   - Verify database file is created at `~/.bsv-desktop/wallet.db`
   - Check that wallet data persists across app restarts

2. **Multi-Identity Support:**
   - Test with multiple identity keys
   - Verify separate storage instances are created

3. **Chain Switching:**
   - Test mainnet → testnet switching
   - Verify correct database file is used

4. **Error Handling:**
   - Test with invalid identity keys
   - Test with corrupted database files
   - Verify error messages are propagated correctly

5. **Cleanup:**
   - Close app and verify database connections are closed
   - Check for file locks or hanging processes

## Performance Considerations

1. **IPC Overhead:**
   - Each storage call requires IPC round-trip
   - For bulk operations, consider batching if performance issues arise
   - Current implementation is suitable for typical wallet usage patterns

2. **Connection Pooling:**
   - StorageManager maintains one connection per identity+chain combination
   - Connections are reused across operations
   - Connections cleaned up on app shutdown

3. **Database Location:**
   - Using SQLite on local disk
   - Fast reads/writes for typical wallet operations
   - No network latency

## Troubleshooting

### Common Issues:

1. **"Cannot find module 'better-sqlite3'" in renderer:**
   - This means StorageKnex is being imported in frontend
   - Check that all imports use StorageElectronIPC, not StorageKnex

2. **Database locked errors:**
   - Ensure only one app instance is running
   - Check that cleanup() is called on app shutdown

3. **IPC timeout errors:**
   - Check electron/storage.ts logs for backend errors
   - Verify database file has write permissions

## Future Enhancements

1. **Database Migrations:**
   - Implement version checking
   - Add migration system for schema changes

2. **Backup/Export:**
   - Add methods to export wallet data
   - Implement backup functionality

3. **Performance Optimization:**
   - Add IPC call batching for bulk operations
   - Implement caching layer if needed

4. **Multi-User Support:**
   - Extend to support multiple user profiles
   - Implement profile switching

## Dependencies

- `better-sqlite3` (^12.4.1) - Native SQLite3 binding
- `knex` (^3.1.0) - SQL query builder
- `@bsv/wallet-toolbox` (^1.6.23) - Wallet storage interfaces

## Related Documentation

- [@bsv/wallet-toolbox Documentation](https://bsv-blockchain.github.io/wallet-toolbox)
- [Electron IPC Documentation](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [StorageKnex API](https://bsv-blockchain.github.io/wallet-toolbox/storage.html)

## Handover Notes

The wallet storage implementation is now complete and follows Electron best practices:

✅ Node.js modules isolated to main process
✅ IPC communication bridge implemented
✅ WalletStorageProvider interface properly implemented
✅ Database connections properly managed
✅ Cleanup handlers in place
✅ Type-safe communication
✅ Error handling implemented
✅ Logging for debugging

The next engineer can now:
- Run the application and test wallet creation
- Verify storage operations work correctly
- Implement additional wallet features using the storage layer
- Add monitoring/analytics if needed

All storage operations now go through the proper Electron IPC architecture, ensuring compatibility and maintainability.
