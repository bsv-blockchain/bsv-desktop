import type React from 'react'
import type { PaletteMode } from '@mui/material'
import type { KeyDeriverApi, WalletInterface } from '@bsv/sdk'

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

export type PermissionModuleFactoryArgs = {
  wallet: WalletInterface
  adminOriginator: string
  promptHandler?: PermissionPromptHandler
  /**
   * The wallet's ordinary BRC-42/43 key deriver, for semantic modules that
   * derive keys inside the wallet (e.g. `p rabin`). Absent when the wallet
   * does not expose one; such modules must then fail closed.
   */
  keyDeriver?: Pick<KeyDeriverApi, 'derivePrivateKey'>
}

export type PermissionModuleDefinition = {
  id: string
  label: string
  enabledByDefault?: boolean
  createModule: (args: PermissionModuleFactoryArgs) => unknown
  Prompt?: React.ComponentType<PermissionPromptProps>
}
