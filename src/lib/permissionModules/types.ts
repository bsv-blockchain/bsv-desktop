import type React from 'react'
import type { PaletteMode } from '@mui/material'
import type { WalletInterface } from '@bsv/sdk'
import type { NetworkSettings, WalletNetwork } from '../networkConfig'

export type PermissionPromptHandler = (app: string, message: string) => Promise<boolean>

export type PermissionPromptProps = {
  id: string
  paletteMode: PaletteMode
  isFocused: () => Promise<boolean>
  onFocusRequested: () => Promise<void>
  onFocusRelinquished: () => Promise<void>
  onRegister: (id: string, handler: PermissionPromptHandler) => void
  onUnregister?: (id: string) => void
}

/** The open wallet a module is built for; it changes on every wallet build. */
export type PermissionModuleContext = {
  identityKey: string
  chain: WalletNetwork
  settings: NetworkSettings
  /**
   * The build selected the local (main-process) storage as active, the only
   * storage the 1Color broadcast guard covers (contract §8.2). False (or
   * missing) for remote storage.
   */
  localStorageSelected: boolean
  /**
   * Authoritative and live: resolves true iff the storage manager's active
   * store is the local one right now (a primary-storage switch does not
   * rebuild the wallet; an unused manager is made available first). A
   * rejection, or any value but `true`, counts as not local.
   */
  isLocalStorageActive: () => Promise<boolean>
  /**
   * The permissions manager of this build, bound to the admin originator;
   * undefined until it exists. The host Mandala runtime internalizes receipts
   * through it so the color module admits them (design §9 B7).
   */
  managedWallet?: () => WalletInterface | undefined
  /**
   * The host's MessageBox client right now (built after the wallet, replaced
   * when its URL changes); undefined while MessageBox is off.
   */
  messageBox?: () => HostMessageBox | undefined
}

/** The MessageBox slice the host Mandala runtime uses (PeerPayClient fits). */
export type HostMessageBox = {
  listMessages: (a: { messageBox: string, acceptPayments?: boolean }) => Promise<unknown>
  acknowledgeMessage: (a: { messageIds: string[] }) => Promise<unknown>
}

export type PermissionModuleFactoryArgs = {
  wallet: WalletInterface
  adminOriginator: string
  promptHandler?: PermissionPromptHandler
  context?: PermissionModuleContext
}

export type PermissionModuleDefinition = {
  id: string
  label: string
  enabledByDefault?: boolean
  createModule: (args: PermissionModuleFactoryArgs) => unknown
  /**
   * Releases what `createModule` started (timers, listeners, grants). Called
   * once per module when the wallet is rebuilt or closed; it must not throw.
   */
  dispose?: (module: unknown) => void
  Prompt?: React.ComponentType<PermissionPromptProps>
}
