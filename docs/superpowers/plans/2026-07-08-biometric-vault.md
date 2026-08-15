# Biometric Vault Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox syntax.

**Goal:** Cold-start vault unlock (biometrics + passphrase) before wallet secrets hydrate and the wallet builds.

**Architecture:** Main-process vault seals `snap`/`primaryKeyHex`/`mnemonic12` under a random DEK (AES-256-GCM). DEK is wrapped by passphrase (scrypt) always and by a biometric wrap (Touch ID presence + OS-sealed bio key) when available. Renderer shows unlock/enroll gate; secrets IPC is locked until unlock.

**Tech Stack:** Electron 41, Node `crypto` (scrypt + AES-GCM), `systemPreferences.promptTouchID` (macOS), React unlock/enroll UI, Vitest.

## Global Constraints

- Allow-listed secret names only: `snap`, `primaryKeyHex`, `mnemonic12`
- Passphrase wrap always required at enroll
- No secret plaintext on disk outside sealed vault after migration
- Cold-start re-lock only (v1)
- KDF in file format: `scrypt` (Node built-in; equivalent role to argon2id in the design)

## Tasks

1. Vault crypto + passphrase + vault module + unit tests
2. Biometric adapter (macOS Touch ID; Windows unavailable → passphrase-only)
3. bootConfig + migration from secrets.dat
4. IPC + preload + wire secrets behind vault lock
5. Renderer secrets/vault facade + main.tsx gate
6. Unlock/Enroll UI + UserInterface integration
7. WalletService boot-config + HTTP WALLET_LOCKED
8. Tests green + typecheck

---
