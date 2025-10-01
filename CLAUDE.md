# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is `@bsv/brc100-ui-react-components`, a React component library for building BSV blockchain wallet UIs. It provides reusable components for wallet authentication, permission management, certificate handling, and blockchain interactions.

## Build Commands

```bash
# Build the library (TypeScript compilation)
npm run build

# Linting (currently no-op)
npm run lint:ci

# Tests (currently no tests configured)
npm test
```

## Core Architecture

### Context System

The application uses two primary React contexts that manage global state:

1. **UserContext** (`src/UserContext.tsx`)
   - Manages UI state and platform-specific handlers
   - Provides native handlers for focus management and file downloads
   - Controls modal states for permission dialogs
   - Stores app version and name

2. **WalletContext** (`src/WalletContext.tsx`)
   - Manages wallet authentication and configuration
   - Handles permission request queues (basket, certificate, protocol, spending, grouped)
   - Implements a sophisticated "group permission gating" system that defers individual permission requests when a grouped permission request is pending
   - Manages wallet managers (authentication, permissions, settings)
   - Controls WAB (Wallet Authentication Backend) configuration and network selection
   - Tracks active user profile and recent apps

### Permission Management System

The library implements a queue-based permission system with the following types:

- **Basket Access**: Requests to access specific data baskets
- **Certificate Access**: Requests to access user certificates (identity verification)
- **Protocol Permissions**: Requests for protocol-level operations (signing, encryption, etc.)
- **Spending Authorization**: Requests to spend satoshis
- **Grouped Permissions**: Batch permission requests that can cover multiple individual requests

**Group Permission Gating**: When a grouped permission request arrives, the system enters a "pending" phase where all new individual requests are deferred into temporary buffers. After the user responds to the grouped request, deferred requests are either auto-approved (if covered by the group decision) or re-queued for individual approval.

### Permission Request Flow

1. Request arrives via callback (e.g., `basketAccessCallback`, `certificateAccessCallback`)
2. If group permission is pending, request is deferred
3. Otherwise, request is added to the appropriate queue
4. Modal opens to show the first request in the queue
5. User approves/denies request
6. Queue advances via `advanceBasketQueue()`, `advanceCertificateQueue()`, etc.
7. When queue empties, modal closes and focus is relinquished (if applicable)

### Main UI Component

**UserInterface** (`src/UserInterface.tsx`) is the top-level component that:
- Wraps the entire application in context providers
- Sets up routing with react-router-dom (HashRouter)
- Renders permission handlers as global components
- Provides routes for Greeter, Dashboard, and Recovery pages

### Request Interception

**RequestInterceptorWallet** (`src/RequestInterceptorWallet.ts`) wraps the underlying wallet to track app usage:
- Intercepts all wallet method calls
- Records the originator (app making the request)
- Updates recent apps list
- Errors are swallowed so tracking never blocks wallet operations

### Configuration

The wallet supports two authentication modes controlled by `useWab` flag:
- **Wabless Mode** (default): Classic wallet interface with custom funder function
- **WAB Mode**: Uses Wallet Authentication Backend with phone/SMS verification

Configuration values in `src/config.ts`:
- `DEFAULT_USE_WAB`: false (wabless mode is default)
- `DEFAULT_CHAIN`: 'main' (or 'test')
- `ADMIN_ORIGINATOR`: 'admin.com'
- `MESSAGEBOX_HOST`: https://messagebox.babbage.systems

### Component Structure

Components are organized by type:
- **Handlers**: Global components that render permission dialogs (e.g., `BasketAccessHandler`, `ProtocolPermissionHandler`)
- **Lists**: Components that display collections of permissions (e.g., `ProtocolPermissionList`, `BasketAccessList`)
- **Chips**: Small UI elements representing entities (e.g., `AppChip`, `CertificateChip`, `ProtoChip`)
- **Pages**: Full page components under `src/pages/` (Dashboard, Greeter, Recovery, etc.)

### Key Dependencies

- `@bsv/wallet-toolbox-client`: Wallet management, authentication, permissions
- `@bsv/sdk`: BSV blockchain operations, cryptography, broadcasting
- `@mui/material`: UI components and theming
- `react-router-dom` v5: Client-side routing
- `react-toastify`: Toast notifications

## TypeScript Configuration

The project uses TypeScript with:
- Target: ESNext
- Module: ESNext with Node resolution
- JSX: react-jsx
- Strict mode: disabled (`strict: false`)
- Output: `dist/` directory
- Type declarations: `dist/types/`

## Exports

The library exports components, contexts, utilities, and types via `src/index.ts`. Main exports include:
- `UserInterface`: Main UI component
- Context providers and values (`UserContext`, `WalletContext`)
- Permission handlers and lists
- Chips and display components
- Utility functions (`parseAppManifest`, `isImageUrl`)
- TypeScript types for permissions and wallet profiles
