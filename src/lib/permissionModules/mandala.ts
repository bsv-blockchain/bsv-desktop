import type { WalletInterface } from '@bsv/sdk'
import type { PermissionModuleDefinition } from './types'
import { readCount } from '../utils/listOutputsCount'
import { MandalaPermissionPrompt } from './mandala/Prompt'
import {
  listAllOutpoints,
  MandalaTokenModule,
  resolveMandalaOutput
} from './mandala/permissionModule'

const MANDALA_BASKET = 'p mandala'

/** Shared by the permission module and the createAction input-routing wrapper. */
export const listMandalaTokenOutpoints = (wallet: WalletInterface, adminOriginator: string): Promise<Set<string>> =>
  listAllOutpoints((limit, offset) => wallet.listOutputs({
    basket: MANDALA_BASKET,
    includeCustomInstructions: false,
    limit,
    offset
  }, adminOriginator).then(page => ({ outputs: page.outputs, totalOutputs: readCount(page.totalOutputs, 'Mandala token outputs') })))

export const mandalaPermissionModule: PermissionModuleDefinition = {
  id: 'mandala',
  label: 'Mandala Token Module',
  enabledByDefault: true,
  createModule: ({ wallet, adminOriginator, promptHandler }) => new MandalaTokenModule({
    adminOriginator,
    requestTokenAccess: promptHandler ?? (async () => false),
    listTokenOutpoints: () => listMandalaTokenOutpoints(wallet, adminOriginator),
    resolveMandalaOutput: (outpoint) => resolveMandalaOutput((limit, offset) => wallet.listOutputs({
      basket: MANDALA_BASKET,
      include: 'locking scripts',
      includeCustomInstructions: false,
      limit,
      offset
    }, adminOriginator).then(page => ({ outputs: page.outputs, totalOutputs: readCount(page.totalOutputs, 'Mandala token outputs') })), outpoint),
    resolveAssetMetadata: async () => null
  }),
  Prompt: MandalaPermissionPrompt
}
