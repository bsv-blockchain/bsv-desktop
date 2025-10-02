# Quick Start Guide

## Prerequisites

- Node.js 18+ (recommended: 20+)
- npm or yarn

## Setup

```bash
cd electron-app
npm install
```

## Run Development Mode

```bash
npm run dev
```

This will:
1. Start Vite dev server (port 5173)
2. Compile Electron TypeScript
3. Launch the Electron app with hot reload

## What You'll See

1. **Main Window**: BSV Desktop wallet UI
2. **DevTools**: Automatically opened for debugging
3. **HTTP Server**: Running on `http://127.0.0.1:3321`

## Testing the HTTP Server

In another terminal:

```bash
# Test authentication endpoint
curl http://127.0.0.1:3321/isAuthenticated

# Should return something like:
# {"authenticated":false}
```

## Wallet Configuration

On first launch, you'll see the wallet configuration screen:

1. **Network**: Choose mainnet or testnet
2. **Auth Method**:
   - Self-custody (local keys) - **Recommended for desktop**
   - WAB (phone verification)
3. **Storage**:
   - Local SQLite - **Recommended** (stored at `~/.bsv-desktop/wallet.db`)
   - Remote Storage Server

## Using Local Storage (SQLite)

The default configuration uses local SQLite storage via Knex:

- **Database Location**: `~/.bsv-desktop/wallet.db`
- **Provider**: `StorageKnex` from `@bsv/wallet-toolbox`
- **No remote server required**

This is configured in the parent library's `WalletContext.tsx` when `useRemoteStorage: false`.

## Project Structure Quick Reference

```
electron-app/
├── electron/
│   ├── main.ts          # Electron main process
│   ├── httpServer.ts    # HTTP server on port 3321
│   └── preload.ts       # IPC bridge
├── src/
│   ├── main.tsx         # React entry point
│   ├── onWalletReady.ts # Wallet HTTP handler
│   └── electronFunctions.ts # Native handlers
└── package.json
```

## Building for Production

```bash
# Build the app
npm run build

# Package for your platform
npm run package

# Or platform-specific:
npm run package:mac    # macOS
npm run package:win    # Windows
npm run package:linux  # Linux
```

Packaged apps will be in `release/` directory.

## Common Issues

### Port 3321 in use
```bash
lsof -ti:3321 | xargs kill -9
```

### Reset wallet
```bash
rm -rf ~/.bsv-desktop/
```

### Clear localStorage
Open DevTools → Application → Local Storage → Clear All

## Next Steps

1. **Configure wallet** on first launch
2. **Test with external apps** by pointing them to `http://127.0.0.1:3321`
3. **Explore the codebase**:
   - HTTP server: `electron/httpServer.ts`
   - Wallet integration: `src/onWalletReady.ts`
   - Storage config: `../src/WalletContext.tsx`

## Debugging Tips

### Main Process Logs
Check the terminal where you ran `npm run dev`

### Renderer Logs
Open DevTools (auto-opens in dev mode)

### HTTP Requests
Use `curl` to test endpoints:
```bash
curl -X POST http://127.0.0.1:3321/isAuthenticated \
  -H "Content-Type: application/json" \
  -H "Origin: http://example.com"
```

## Getting Help

- Check [README.md](README.md) for full documentation
- Review [CLAUDE.md](../CLAUDE.md) for codebase architecture
- Open an issue on GitHub
