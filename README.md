# BSV Desktop

A cross-platform desktop wallet application for the BSV Blockchain, built with Electron and Vite. BSV Desktop provides a complete wallet interface with support for both self-custody (local) and remote storage options.

The default configuration is for locally stored transactions and metadata, entirely self custody.

> **Note**: This project was migrated from Tauri to Electron to enable local database storage. See [PORTED.md](PORTED.md) for the full migration story.

## What is BSV Desktop?

BSV Desktop is a feature-rich Bitcoin SV wallet that runs on macOS, Windows, and Linux. It provides:

- **🔐 Self-Custody Mode** - Full control with local key management and SQLite storage
- **☁️ Remote Storage Mode** - WAB (Wallet Authentication Backend) integration with remote storage
- **🌐 BRC-100 Interface** - HTTPS server on port 2121 for external app integration
- **📱 Identity Certificates** - BRC-64/65 certificate management
- **💸 Payment Protocol** - BRC-29 payment support
- **🎯 Overlay Services** - App permissions, baskets, protocols, counterparties
- **🔄 Background Monitoring** - Automatic transaction and proof updates
- **💾 Flexible Storage** - Choose between local SQLite or remote storage providers

## Architecture

BSV Desktop consists of three main components:

### 1. **React UI Library** (`src/lib/`)
Reusable React components and wallet logic:
- `WalletContext.tsx` - Wallet state management and initialization
- `UserInterface.tsx` - Main router and permission handlers
- Permission handlers for baskets, certificates, protocols, spending
- Dashboard pages for apps, identity, trust, settings

### 2. **Electron Main Process** (`electron/`)
Native functionality and backend services:
- `main.ts` - Window management, IPC handlers
- `httpServer.ts` - BRC-100 HTTPS server on port 2121
- `storage.ts` - SQLite storage manager with IPC proxy
- `monitor-worker.ts` - Background monitoring process

### 3. **Renderer Process** (`src/`)
Application entry point that uses the UI library:
- `main.tsx` - React app entry, wallet initialization
- `onWalletReady.ts` - HTTP request handler for BRC-100 interface
- `electronFunctions.ts` - Native handlers (focus, downloads, dialogs)

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Git

### Installation

```bash
git clone https://github.com/bsv-blockchain/bsv-desktop.git
cd bsv-desktop
npm install
```

### Development Mode

Run the app in development mode with hot reload:

```bash
npm run dev
```

This will:
1. Start Vite dev server on port 5173
2. Compile TypeScript for Electron backend
3. Launch Electron with DevTools open
4. Enable hot module replacement for React code

**Dev Mode Features**:
- Automatic recompilation on file changes
- React DevTools enabled
- Console logs from both main and renderer processes
- HTTPS server running on `https://localhost:2121`

### Building

Build the application for production:

```bash
npm run build
```

This runs:
- `npm run build:renderer` - Vite build → `dist/`
- `npm run build:electron` - TypeScript build → `dist-electron/`

### Packaging

Package the app for distribution:

```bash
# Build for current platform
npm run package

# Platform-specific builds
npm run package:mac    # macOS (DMG + ZIP)
npm run package:win    # Windows (NSIS + Portable)
npm run package:linux  # Linux (AppImage + DEB)
```

Built packages will be in the `release/` directory with versioned filenames.

## Project Structure

```
bsv-desktop/
├── src/lib/                      # React UI library (reusable)
│   ├── WalletContext.tsx         # Wallet state and initialization
│   ├── UserContext.tsx           # App metadata and native handlers
│   ├── components/               # Reusable components
│   │   ├── WalletConfig.tsx      # WAB/storage configuration
│   │   ├── AmountDisplay.tsx     # Currency display with rates
│   │   └── *Handler.tsx          # Permission request modals
│   ├── pages/                    # Dashboard pages
│   │   ├── Dashboard/            # Main dashboard and settings
│   │   └── Recovery/             # Password/phone recovery
│   └── navigation/               # Menu and routing
│
├── src/                          # Electron app entry
│   ├── main.tsx                  # React app initialization
│   ├── onWalletReady.ts          # BRC-100 HTTPS handler
│   ├── electronFunctions.ts      # Native handlers (focus, downloads, dialogs)
│   └── StorageElectronIPC.ts     # IPC storage proxy
│
├── electron/                     # Electron backend
│   ├── main.ts                   # Main process, window lifecycle
│   ├── httpServer.ts             # Express server (port 2121)
│   ├── storage.ts                # Storage manager + IPC handlers
│   ├── monitor-worker.ts         # Background monitoring process
│   ├── preload.ts                # IPC bridge (context isolation)
│   └── storage-loader.cjs        # Lazy-load better-sqlite3
│
├── dist/                         # Vite build output
├── dist-electron/                # TypeScript build output
├── release/                      # Packaged apps
│
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript config (renderer)
├── tsconfig.electron.json        # TypeScript config (main)
├── vite.config.ts                # Vite build config
└── electron-builder.json5        # Packaging config
```
## Configuration

Users can configure at runtime via the WalletConfig component:
- **Authentication**: WAB or self-custody (default: self-custody)
- **Network**: Mainnet or testnet
- **Storage**: Remote (StorageClient) or local (SQLite)
- **Message Box**: Enable/disable message box integration

Configuration is persisted in **Version 3 snapshots** (localStorage + encrypted).
## Storage Modes

### Local Storage (Self-Custody)
- **Database**: SQLite via better-sqlite3 + Knex
- **Location**: `~/.bsv-desktop/wallet.db` (mainnet) or `wallet-test.db` (testnet)
- **Features**: Full offline mode, no external dependencies
- **Architecture**: IPC proxy from renderer → main → StorageKnex

### Remote Storage (WAB)
- **Provider**: StorageClient (HTTP-based)
- **Server**: User-configured URL (e.g., `https://storage.babbage.systems`)
- **Features**: Cloud backup, multi-device sync
- **Authentication**: WAB (Wallet Authentication Backend) with phone/DevConsole verification

## Background Monitoring

BSV Desktop runs a separate Monitor worker process that:
- Monitors for new transactions
- Updates merkle proofs
- Tracks UTXO state changes
- Syncs certificates and outputs

**Implementation**:
- `electron/monitor-worker.ts` - Separate Node.js process
- SQLite WAL mode enables concurrent access
- Automatic start on wallet initialization
- Graceful shutdown on app exit

## HTTP Server (BRC-100 Interface)

External apps can connect to the wallet via HTTPS on port 2121:

**Endpoints**:
- `POST /createAction` - Create and broadcast transactions
- `POST /createHmac` - Generate HMAC signatures
- `POST /createCertificate` - Create identity certificates
- `GET /isAuthenticated` - Check wallet authentication status
- And all other BRC-100 interface methods

**CORS**: Enabled for all origins in dev mode

**Testing**:
```bash
curl https://127.0.0.1:2121/isAuthenticated
```

## Contributing

We welcome contributions! Here's how to get started:

### Development Workflow

1. **Fork and clone** the repository
2. **Create a feature branch**: `git checkout -b feature/my-feature`
3. **Make changes** and test with `npm run dev`
4. **Build**: `npm run build` to ensure compilation succeeds
5. **Test packaging**: `npm run package` to verify build output
6. **Commit**: Use clear commit messages
7. **Push and create PR**: Describe changes and test coverage

### Code Structure

- **UI components** go in `src/lib/components/`
- **Pages** go in `src/lib/pages/`
- **Electron backend** changes go in `electron/`
- **Shared types** go in `src/lib/types/` or `src/global.d.ts`

### Testing

Currently no automated tests. Manual testing checklist:
- [ ] App launches and shows login screen
- [ ] WAB authentication works (with real WAB server)
- [ ] Self-custody mode works (local database)
- [ ] Balance displays correctly
- [ ] Sending transactions works
- [ ] HTTPS server responds on port 2121
- [ ] App packages without errors

### Debugging

**Main Process** (Electron backend):
```bash
# Logs appear in terminal where `npm run dev` runs
console.log('[Main]', 'Debug message')
```

**Renderer Process** (React UI):
```bash
# Open DevTools (auto-opens in dev mode)
# Cmd+Option+I (macOS) or Ctrl+Shift+I (Windows/Linux)
console.log('[Renderer]', 'Debug message')
```

**HTTP Server**:
```bash
# Test endpoints
curl -X POST https://127.0.0.1:2121/isAuthenticated
```

## Releasing a New Version

### 1. Update Version

Edit `package.json`:
```json
{
  "version": "0.7.0"
}
```

### 2. Commit and Tag

```bash
git add package.json
git commit -m "Bump version to 0.7.0"
git tag v0.7.0
git push origin master --tags
```

### 3. Build Packages

```bash
# Build for all platforms (requires platform-specific machines)
npm run package:mac
npm run package:win
npm run package:linux

# Or build for current platform only
npm run package
```

### 4. Publish Release

1. Go to GitHub Releases
2. Click "Draft a new release"
3. Select tag `v0.7.0`
4. Upload files from `release/` directory:
   - `BSV-Desktop-0.7.0.dmg` (macOS)
   - `BSV-Desktop-0.7.0-mac.zip` (macOS)
   - `BSV-Desktop-Setup-0.7.0.exe` (Windows)
   - `BSV-Desktop-0.7.0.AppImage` (Linux)
   - `bsv-desktop_0.7.0_amd64.deb` (Linux)
5. Write release notes highlighting changes
6. Click "Publish release"

### 5. Update Documentation

Update README.md, PORTED.md, or CHANGELOG.md as needed.

## Dependencies

### Core Wallet
- `@bsv/wallet-toolbox` - Wallet managers, storage, permissions
- `@bsv/sdk` - BSV blockchain primitives
- `@bsv/message-box-client` - Message box integration
- `@bsv/uhrp-react` - UHRP protocol support

### Electron Backend
- `electron` - Desktop framework
- `express` - HTTP server
- `better-sqlite3` - SQLite database
- `knex` - SQL query builder

### React Frontend
- `react` + `react-dom` - UI framework
- `@mui/material` + `@emotion` - Material-UI components
- `react-router-dom` - Routing (v5)
- `react-toastify` - Toast notifications

## License

Open BSV License

## Support

- **Issues**: [GitHub Issues](https://github.com/bsv-blockchain/bsv-desktop/issues)
- **Discussions**: [GitHub Discussions](https://github.com/bsv-blockchain/bsv-desktop/discussions)
- **Documentation**: See [PORTED.md](PORTED.md) for architecture details

## Related Projects

- [wallet-toolbox](https://github.com/bsv-blockchain/wallet-toolbox) - Core wallet functionality
- [ts-sdk](https://github.com/bsv-blockchain/ts-sdk) - BSV TypeScript SDK
- [overlay-services](https://github.com/bsv-blockchain/overlay-express-examples) - Overlay network infrastructure

