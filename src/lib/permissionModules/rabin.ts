import { createRabinModule, type RabinKeyDeriver } from '@bsv/rabin-permission-module'
import type { PermissionModuleDefinition } from './types'
import { RabinPermissionPrompt } from './rabin/Prompt'
import { RABIN_GRANT_MINUTES, toRabinPromptMessage } from './rabin/promptMessage'

/** Used when the wallet has no key deriver: every request fails closed, before any prompt. */
const KEY_DERIVER_UNAVAILABLE = 'RABIN: key deriver unavailable'

const unavailableKeyDeriver: RabinKeyDeriver = {
  derivePrivateKey: () => {
    throw new Error(KEY_DERIVER_UNAVAILABLE)
  }
}

/**
 * BRC-206 `p rabin`: wallet-held Rabin keys and signatures, carried over `encrypt`.
 * Privileged Rabin keys are not supported here: the toolbox exposes no privileged
 * `derivePrivateKey`, so privileged requests fail before any prompt.
 */
export const rabinPermissionModule: PermissionModuleDefinition = {
  id: 'rabin',
  label: 'Rabin Signature Module',
  enabledByDefault: true,
  needsKeyDeriver: true,
  createModule: ({ keyDeriver, promptHandler }) => createRabinModule({
    keyDeriver: keyDeriver ?? unavailableKeyDeriver,
    authorizationTTL: RABIN_GRANT_MINUTES * 60 * 1000,
    // Without a key deriver nothing can be served, so do not ask the user first.
    authorize: keyDeriver
      ? request => promptHandler?.(request.originator, JSON.stringify(toRabinPromptMessage(request))) ?? Promise.resolve(false)
      : () => { throw new Error(KEY_DERIVER_UNAVAILABLE) }
  }),
  Prompt: RabinPermissionPrompt
}
