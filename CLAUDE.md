# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**bsv-desktop** is a React-based library that provides reusable UI components and wallet functionality for building BSV blockchain applications. It wraps wallet functionality implementing the BRC-100 standard interface and provides a complete user interface for wallet interactions.

## Key Commands

### Build
```bash
npm run build
```
Compiles TypeScript files to `dist/` directory with type declarations in `dist/types/`.

### Linting & Testing
```bash
npm run lint:ci  # Currently no-op
npm run test     # Currently no tests
```

## Architecture Overview

### Core Context System

The application uses two primary React contexts that work together:

1. **WalletContext** ([WalletContext.tsx](src/WalletContext.tsx))
   - Manages all wallet-related state and operations
   - Handles three wallet manager types:
     - `WalletAuthenticationManager` (WAB-based, with phone/DevConsole auth)
     - `CWIStyleWalletManager` (local, self-custody)
     - Both build a `WalletPermissionsManager` that handles user permission requests
   - Manages permission request queues (basket, certificate, protocol, spending, grouped)
   - Implements group permission gating to batch related permission requests
   - Stores network configuration (mainnet/testnet), WAB settings, storage settings
   - Handles snapshot loading/saving for returning users

2. **UserContext** ([UserContext.tsx](src/UserContext.tsx))
   - Provides platform-agnostic native handlers (focus, download, etc.)
   - Manages modal visibility state for permission request handlers
   - Stores app metadata (version, name)

### Wallet Configuration & Initialization

The wallet supports two authentication modes, configured via `config.ts`:

- **WAB Mode** (`useWab: true`): Uses `WalletAuthenticationManager` with phone verification (Twilio or DevConsole)
- **Self-Custody Mode** (`useWab: false`): Uses `CWIStyleWalletManager` for local key management

Configuration flow:
1. New users see `WalletConfig` component to set network, auth method, storage
2. Returning users auto-load from localStorage snapshot
3. Config stored in `WalletContext` state: `wabUrl`, `selectedNetwork`, `selectedStorageUrl`, `useWab`, `useRemoteStorage`, `useMessageBox`

Storage options (configured in `buildWallet`):
- Remote: `StorageClient` with user-provided URL
- Local: `StorageKnex` with better-sqlite3 at `~/.bsv-desktop/wallet.db`

### Permission Request Flow

Permission requests follow a queue-based system:

1. **Request Reception**: Apps request permissions via `WalletPermissionsManager` callbacks
2. **Queueing**: Requests are added to type-specific queues in `WalletContext`
3. **Group Gating**: When a grouped permission request arrives, all individual requests are deferred until group decision is made
4. **Modal Display**: Handlers (e.g., `BasketAccessHandler`) show modals for the first queued request
5. **User Decision**: User approves/denies via permission manager methods
6. **Queue Advancement**: Modal closes and next request is shown via `advance*Queue()` methods

Group permission flow:
- `groupPhase` state tracks 'idle' | 'pending'
- When grouped request arrives, individual requests are buffered in `deferred` state
- After grouped decision, buffered requests are evaluated against the decision
- Uncovered requests are re-queued for individual approval

### Request Interceptor

`RequestInterceptorWallet` wraps the wallet interface to track app usage:
- Intercepts all wallet method calls
- Records originator domain via `updateRecentApp()`
- Swallows tracking errors to prevent blocking wallet operations
- Recent apps stored in localStorage as `brc100_recent_apps_{profileId}`

### Component Structure

Key components exported in [index.ts](src/index.ts):

**Permission Handlers** (modal-based UI for permission requests):
- `BasketAccessHandler`, `CertificateAccessHandler`, `ProtocolPermissionHandler`
- `GroupPermissionHandler`, `SpendingAuthorizationHandler`
- `PasswordHandler`, `RecoveryKeyHandler`

**Display Components**:
- `AmountDisplay` with `ExchangeRateContextProvider` for currency conversion
- Chips: `AppChip`, `BasketChip`, `CertificateChip`, `CounterpartyChip`, `ProtoChip`
- `Profile`, `RecentActions`, `AccessAtAGlance`

**UI Infrastructure**:
- `UserInterface`: Main router component with permission handlers
- `AppThemeProvider`: Material-UI theming
- `PageHeader`, `PageLoading`, `CustomDialog`

### Page Structure

Dashboard pages in [src/pages/Dashboard/](src/pages/Dashboard/):
- `/dashboard`: Main dashboard with apps, recent actions, balance
- `/dashboard/apps`: App catalog and recently used apps
- `/dashboard/my-identity`: Identity certificates management
- `/dashboard/trust`: Trusted entities configuration
- `/dashboard/settings`: Password, recovery key management
- Access pages: `/app-access`, `/basket-access`, `/certificate-access`, `/protocol-access`, `/counterparty-access`

### Important Implementation Details

**Snapshot Management**:
- Wallet state persisted to `localStorage.snap` as base64
- Loaded on mount if present, triggering `snapshotLoaded` flag
- Determines returning vs. new user flow

**Network Configuration**:
- `selectedNetwork`: 'main' | 'test' stored in WalletContext
- Affects `LookupResolver` and `SHIPBroadcaster` initialization
- Network changes require rebuilding wallet managers

**Focus Management**:
- Permission requests can request app focus via `onFocusRequested()`
- Focus relinquished via `onFocusRelinquished()` when queues empty
- Prevents app from stealing focus when user is elsewhere

**Recent Apps Tracking**:
- Automatic metadata fetching (favicon, manifest) for new domains
- Cached in localStorage to avoid repeated fetches
- Debounced updates (5s) to prevent duplicate tracking
- Supports pinning apps via `isPinned` flag

## Key Dependencies

- `@bsv/wallet-toolbox`: Wallet managers, permissions, storage, authentication
- `@bsv/sdk`: Core BSV blockchain SDK (transactions, keys, signing)
- `@bsv/message-box-client`: Message box functionality
- `@bsv/uhrp-react`: UHRP protocol support
- Material-UI (`@mui/material`, `@emotion`): UI components
- `react-router-dom` v5: Client-side routing
- `knex` + `better-sqlite3`: Local database storage
- `react-toastify`: Toast notifications

## Development Notes

**Working with Permissions**:
- Permission request callbacks are bound in `buildWallet()` function
- Each permission type has dedicated callback, queue, and modal state
- Always call `advance*Queue()` after handling a permission to show next request
- Group permissions use separate flow with `groupDecisionRef` and deferred buffers

**Adding New Permission Types**:
1. Add queue state to `WalletContext` (similar to `basketRequests`)
2. Create callback in `WalletContext` (similar to `basketAccessCallback`)
3. Bind callback in `buildWallet()` via `permissionsManager.bindCallback()`
4. Add advance function (similar to `advanceBasketQueue()`)
5. Create handler component (similar to `BasketAccessHandler`)
6. Add handler to `UserInterface.tsx`

**Storage Backend**:
- For local mode, ensure `~/.bsv-desktop/` directory is writable
- Remote storage requires valid StorageClient URL
- Storage provider is added via `storageManager.addWalletStorageProvider()`

**Configuration Changes**:
- Default config in [config.ts](src/config.ts): `DEFAULT_CHAIN`, `ADMIN_ORIGINATOR`, `DEFAULT_USE_WAB`
- Config finalized via `finalizeConfig()` which validates and stores settings
- `configStatus` tracks: 'initial' | 'editing' | 'configured'

**TypeScript**:
- `strict: false` in tsconfig - existing code not fully type-safe
- Declaration files generated to `dist/types/`
- Target: ESNext, Module: ESNext with Node resolution
