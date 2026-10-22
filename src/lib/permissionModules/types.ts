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
