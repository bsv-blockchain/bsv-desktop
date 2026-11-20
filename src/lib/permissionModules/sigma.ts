/**
 * The sigma permission module (`p sigma`) as a desktop permission module:
 * zero-knowledge proofs from a wallet-held key, each approved by the user
 * through `SigmaPermissionPrompt`. It derives keys itself, so it asks for the
 * scoped key deriver.
 */

import type { PermissionModuleDefinition } from './types'
import { createHostSigmaModule, disposeHostSigmaModule } from './sigma/module'
import { SigmaPermissionPrompt } from './sigma/Prompt'

export const sigmaPermissionModule: PermissionModuleDefinition = {
  id: 'sigma',
  label: 'Sigma Proof Module',
  enabledByDefault: true,
  needsKeyDeriver: true,
  createModule: createHostSigmaModule,
  dispose: disposeHostSigmaModule,
  Prompt: SigmaPermissionPrompt
}
