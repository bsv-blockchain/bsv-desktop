# BSV Desktop - Electron Edition

This is the Electron port of the BSV Desktop wallet application, replacing the Tauri (Rust) backend with a Node.js backend while maintaining all the same functionality.

## Architecture

The application consists of three main layers:

### 1. **Electron Main Process** (`electron/main.ts`)
- Window management and lifecycle
- Cross-platform focus handling (macOS/Windows/Linux)
- IPC handlers for native functionality
- HTTP server coordinator

### 2. **HTTP Server** (`electron/httpServer.ts`)
- Express server on `http://127.0.0.1:3321`
- Proxies BRC-100 wallet interface calls from external apps
- Full CORS support for local development
- Request/response bridging between HTTP and renderer process

### 3. **Renderer Process** (React Frontend)
- `@bsv/brc100-ui-react-components` UserInterface
- Wallet functionality via `@bsv/wallet-toolbox`
- SQLite-based local storage via Knex
- HTTP request handler via `onWalletReady`

## Key Features Ported from Tauri/Rust

✅ **HTTP Server (Port 3321)** - External apps can connect to the wallet
✅ **Window Focus Management** - Platform-specific focus grab/release
✅ **File Downloads** - Save files to Downloads folder with duplicate handling
✅ **File Save Dialog** - User-prompted file saving
✅ **Manifest Fetch Proxy** - Secure CORS-free manifest.json fetching
✅ **IPC Communication** - Event-based communication between processes
✅ **SQLite Storage** - Local Knex-based storage at `~/.bsv-desktop/wallet.db`

## Installation

```bash
cd electron-app
npm install
```

## Development

Run the development server (hot reload enabled):

```bash
npm run dev
```

This will:
1. Start Vite dev server on port 5173
2. Compile TypeScript for Electron
3. Launch Electron with dev tools

## Building

Build the application for production:

```bash
npm run build
```

This compiles both the renderer (Vite) and main process (TypeScript).

## Packaging

Package the app for distribution:

```bash
# For current platform
npm run package

# Platform-specific
npm run package:mac   # macOS (DMG + ZIP)
npm run package:win   # Windows (NSIS + Portable)
npm run package:linux # Linux (AppImage + DEB)
```

Built packages will be in the `release/` directory.

## Project Structure

```
electron-app/
├── electron/                 # Electron main process
│   ├── main.ts              # Main entry point, window management
│   ├── httpServer.ts        # HTTP server on port 3321
│   └── preload.ts           # IPC bridge (context isolation)
├── src/                     # React renderer process
│   ├── main.tsx             # React app entry point
│   ├── onWalletReady.ts     # Wallet HTTP request handler
│   ├── electronFunctions.ts # Native handlers for UserInterface
│   └── fetchProxy.ts        # Manifest.json fetch proxy
├── dist/                    # Built renderer (Vite output)
├── dist-electron/           # Built main process (tsc output)
├── release/                 # Packaged applications
├── package.json             # Dependencies and scripts
├── tsconfig.json            # TypeScript config (renderer)
├── tsconfig.electron.json   # TypeScript config (main process)
└── vite.config.ts           # Vite build config
```

## How It Works

### HTTP Server Flow

1. External app makes HTTP request to `http://127.0.0.1:3321/createAction`
2. Express server receives request in main process
3. Main process sends IPC message `http-request` to renderer
4. Renderer's `onWalletReady` handler processes via `WalletInterface`
5. Renderer sends IPC message `http-response` back to main
6. Main process returns HTTP response to external app

### Storage

The wallet uses SQLite for local storage:
- **Location**: `~/.bsv-desktop/wallet.db`
- **Provider**: `StorageKnex` from `@bsv/wallet-toolbox`
- **Database**: better-sqlite3 via Knex

This is configured in `WalletContext.tsx` in the parent `bsv-desktop` library when `useRemoteStorage: false`.

## Differences from Tauri Version

| Feature | Tauri (Rust) | Electron (Node.js) |
|---------|--------------|-------------------|
| HTTP Server | Hyper | Express |
| IPC | Tauri Events | Electron IPC |
| Native Handlers | Tauri Commands | Electron IPC Handlers |
| Build Output | Single binary | ASAR + native modules |
| File Size | Smaller (~10-15MB) | Larger (~80-100MB) |
| Startup Time | Faster | Slightly slower |
| Development | Rust + TypeScript | TypeScript only |

## Configuration

The wallet configuration is managed in the parent `bsv-desktop` library:

- **`src/config.ts`**: Default settings (network, WAB, storage)
- **`src/WalletContext.tsx`**: Wallet initialization and config flow

### Default Settings

```typescript
DEFAULT_CHAIN = 'main'          // mainnet or testnet
DEFAULT_USE_WAB = false         // self-custody mode
ADMIN_ORIGINATOR = 'admin.com'  // admin domain
```

## Native Functions

The following native functions are exposed to the renderer via `electronFunctions.ts`:

- **`isFocused()`** - Check if window is focused
- **`onFocusRequested()`** - Request focus (platform-specific)
- **`onFocusRelinquished()`** - Release focus (minimize/hide)
- **`onDownloadFile(blob, filename)`** - Download file to Downloads folder

These are passed to `UserInterface` as `nativeHandlers`.

## Debugging

### Main Process
- Logs appear in terminal where `npm run dev` was run
- Use `console.log()` in `electron/` files

### Renderer Process
- Open DevTools automatically in dev mode
- Press `Cmd+Option+I` (macOS) or `Ctrl+Shift+I` (Windows/Linux)

### HTTP Server
- Test endpoints: `curl http://127.0.0.1:3321/isAuthenticated`
- Check CORS: All requests include `Access-Control-Allow-Origin: *`

## Troubleshooting

### Port 3321 Already in Use
- Kill existing process: `lsof -ti:3321 | xargs kill -9`
- Or change port in `electron/httpServer.ts`

### SQLite Database Issues
- Database location: `~/.bsv-desktop/wallet.db`
- Delete database: `rm -rf ~/.bsv-desktop/`
- Rebuild schema on next launch

### Window Focus Not Working
- macOS: Requires accessibility permissions
- Windows: May need to run as administrator
- Linux: Depends on window manager

## Dependencies

### Core
- `electron` - Cross-platform desktop framework
- `@bsv/wallet-toolbox` - Wallet functionality
- `@bsv/sdk` - BSV blockchain SDK
- `@bsv/brc100-ui-react-components` - UI library

### Backend (Main Process)
- `express` - HTTP server
- `cors` - CORS middleware
- `better-sqlite3` - SQLite database
- `knex` - SQL query builder

### Frontend (Renderer)
- `react` + `react-dom` - UI framework
- `@mui/material` - Material-UI components
- `react-router-dom` - Routing
- `react-toastify` - Notifications

## License

Open BSV License

## Support

For issues specific to the Electron port, please check:
1. Main process logs (terminal)
2. Renderer logs (DevTools console)
3. HTTP server connectivity (`curl http://127.0.0.1:3321/isAuthenticated`)
