import type React from 'react'
import type { PaletteMode } from '@mui/material'
import type { WalletInterface } from '@bsv/sdk'

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
  promptHandler?: PermissionPromptHandler
}

export type PermissionModuleDefinition = {
  id: string
  label: string
  enabledByDefault?: boolean
  createModule: (args: PermissionModuleFactoryArgs) => unknown
  Prompt?: React.ComponentType<PermissionPromptProps>
}
