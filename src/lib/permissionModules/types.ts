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

export type PermissionModuleKeyDeriver = Pick<KeyDeriverApi, 'derivePrivateKey'>

export type PermissionModuleFactoryArgs = {
  wallet: WalletInterface
  adminOriginator: string
  promptHandler?: PermissionPromptHandler
  /**
   * The wallet's ordinary BRC-42/43 key deriver, limited to the module's own `p <id> …`
   * protocols. Given only to modules that set `needsKeyDeriver`, and only when the wallet has one;
   * such modules must fail closed without it.
   */
  keyDeriver?: PermissionModuleKeyDeriver
}

export type PermissionModuleDefinition = {
  id: string
  label: string
  enabledByDefault?: boolean
  /** Semantic modules that derive keys inside the wallet (e.g. `p rabin`) set this. */
  needsKeyDeriver?: boolean
  createModule: (args: PermissionModuleFactoryArgs) => unknown
  Prompt?: React.ComponentType<PermissionPromptProps>
}
