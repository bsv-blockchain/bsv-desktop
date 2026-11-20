/**
 * The `p sigma` permission module (`@bsv/sigma-permission-module`) as the
 * host builds it for one open wallet.
 *
 * The module makes zero-knowledge proofs from a wallet-held key. It is built
 * with the scoped key deriver the host hands to modules that ask for one, and
 * with the module's default `proofAuthorization` ('each'): at security levels
 * 1 and 2 the user is asked once for a plain public key (remembered for
 * SIGMA_KEY_GRANT_MS) and once for every proof. Level 0 is never prompted.
 *
 * Privileged requests and requests for a counterparty other than self are not
 * supported in this version. A thin host wrapper refuses them before the
 * module sees them, at every level and whatever was approved before; `authorize`
 * also refuses them without prompting.
 *
 * Without a key deriver (or one the module cannot use) the factory returns a
 * module that refuses every request. The factory never throws.
 */

import {
  SigmaPermissionModule,
  type SigmaAuthorizationRequest,
  type SigmaKeyDeriver
} from '@bsv/sigma-permission-module'
import type { PermissionsModule } from '@bsv/wallet-toolbox-client'
import type { PermissionModuleFactoryArgs } from '../types'
import { sigmaPromptMessage } from './message'

/** How long an approved public-key request is remembered. */
export const SIGMA_KEY_GRANT_MS = 30 * 60 * 1000

const UNAVAILABLE = 'Sigma proofs are unavailable in this wallet'
const NOT_SUPPORTED =
  'Sigma: privileged requests and requests for a counterparty other than self are not supported in this version'

type HostSigmaModule = PermissionsModule & { dispose: () => void }

/** Refuses every request; built when the wallet cannot serve sigma proofs. */
function refusingSigmaModule (): HostSigmaModule {
  const refuse = async (): Promise<never> => { throw new Error(UNAVAILABLE) }
  return {
    handleRequest: refuse,
    onRequest: refuse,
    onResponse: refuse,
    dispose: () => {}
  }
}

/** True for request arguments this version does not support (an absent counterparty means self). */
function isUnsupported (args: unknown): boolean {
  if (typeof args !== 'object' || args === null) return false
  const { privileged, counterparty } = args as { privileged?: unknown, counterparty?: unknown }
  return privileged === true || (counterparty !== undefined && counterparty !== 'self')
}

/**
 * Refuses unsupported requests before `module` sees them; everything else,
 * including a request that is not an object, reaches the module unchanged.
 */
function hostWrapper (module: SigmaPermissionModule): HostSigmaModule {
  return {
    handleRequest: async (request, next) => {
      const args = typeof request === 'object' && request !== null ? request.args : undefined
      if (isUnsupported(args)) throw new Error(NOT_SUPPORTED)
      return await module.handleRequest(request, next)
    },
    onRequest: request => module.onRequest(request),
    onResponse: (result, context) => module.onResponse(result, context),
    dispose: () => module.dispose()
  }
}

export function createHostSigmaModule (args: PermissionModuleFactoryArgs): PermissionsModule {
  const keyDeriver = args?.keyDeriver
  if (keyDeriver === undefined) {
    console.warn('[sigma] no key deriver for this wallet; sigma requests are refused')
    return refusingSigmaModule()
  }
  const promptHandler = args.promptHandler
  // Resolves exactly true only when the user approved this request.
  const authorize = async (request: SigmaAuthorizationRequest): Promise<boolean> => {
    // Not supported in this version: refused before anyone is asked.
    if (request.privileged === true || request.counterparty !== 'self') return false
    return (await promptHandler?.(request.originator, sigmaPromptMessage(request))) ?? false
  }
  try {
    const module = new SigmaPermissionModule({
      // The module's typings and this app's resolve two copies of the same @bsv/sdk 4.0.1
      // declarations, which a private class member makes distinct types; the runtime value is the same.
      keyDeriver: keyDeriver as unknown as SigmaKeyDeriver,
      authorizationTTL: SIGMA_KEY_GRANT_MS,
      authorize
    })
    return hostWrapper(module)
  } catch (e) {
    console.warn('[sigma] the module could not be built; sigma requests are refused', e)
    return refusingSigmaModule()
  }
}

/** Disposes the module behind the host wrapper, when there is one. Never throws. */
export function disposeHostSigmaModule (module: unknown): void {
  if (module === null || (typeof module !== 'object' && typeof module !== 'function')) return
  try {
    const dispose = (module as { dispose?: unknown }).dispose
    if (typeof dispose === 'function') dispose.call(module)
  } catch (e) {
    console.error('[sigma] dispose failed', e)
  }
}
