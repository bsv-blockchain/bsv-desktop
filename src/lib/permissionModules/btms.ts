import { createBtmsModule } from '@bsv/btms-permission-module'
import { BtmsPermissionPrompt } from '@bsv/btms-permission-module-ui'
import type { PermissionModuleDefinition } from './types'

export const btmsPermissionModule: PermissionModuleDefinition = {
  id: 'btms',
  label: 'BTMS Token Module',
  enabledByDefault: true,
  createModule: createBtmsModule,
  Prompt: BtmsPermissionPrompt
}
