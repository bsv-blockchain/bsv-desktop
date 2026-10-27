import { KeyDeriver, PrivateKey as EcpmTestPrivateKey } from '@bsv/sdk'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { WalletPermissionsManager } from '@bsv/wallet-toolbox-client'

// The btms prompt is a React component; the registry only needs its identity.
vi.mock('@bsv/btms-permission-module-ui', () => ({ BtmsPermissionPrompt: () => null }))
vi.mock('../src/lib/WalletContext', () => ({ DEFAULT_PERMISSIONS_CONFIG: {} }))

import { buildPermissionModuleRegistry } from '../src/lib/permissionModules/registry'
import { btmsPermissionModule } from '../src/lib/permissionModules/btms'
import { colorPermissionModule } from '../src/lib/permissionModules/color'
import { PermissionQueueManager } from '../src/lib/services/PermissionQueueManager'

beforeEach(() => vi.stubGlobal('window', {}))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// No backward compatibility (design §3): a settings file saved by a build that
// shipped the old Mandala module still lists 'mandala'. Restoring must drop the
// unknown id and keep the defaults, not fail or resurrect the module.
test('a saved mandala id is dropped and defaults are restored', () => {
  const r = buildPermissionModuleRegistry([btmsPermissionModule])
  expect(r.restoreEnabledPermissionModules(['btms', 'mandala'])).toEqual(['btms'])
  expect(r.restoreEnabledPermissionModules(['mandala'])).toEqual(['btms'])
  expect(r.getPermissionModuleById('mandala')).toBeUndefined()
})

// The BRC-207 color module replaces it under the scheme id 'color' and is
// default-enabled, so a saved list from the old build gains it on restore.
test('registry: a saved mandala id becomes color', () => {
  const r = buildPermissionModuleRegistry([btmsPermissionModule, colorPermissionModule])
  expect(r.restoreEnabledPermissionModules(['btms', 'mandala'])).toEqual(['btms', 'color'])
  expect(r.restoreEnabledPermissionModules(undefined)).toEqual(['btms', 'color'])
  expect(r.getPermissionModuleById('color')).toBe(colorPermissionModule)
})

test('main.tsx registers btms and color', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const main = fs.readFileSync(path.resolve(__dirname, '../src/main.tsx'), 'utf8')
  expect(main).toMatch(/permissionModules=\{\[btmsPermissionModule, colorPermissionModule\]\}/)
})

test('the Mandala module source is gone', async () => {
  await expect(import('../src/lib/permissionModules/mandala')).rejects.toThrow()
})

// The old input-routing Proxy replaced createAction with a per-access closure
// that relabelled token-input spends. The manager is now returned unwrapped:
// createAction is the toolbox's own method, routed by baskets and labels only.
test('createPermissionsManager returns an unwrapped WalletPermissionsManager', () => {
  const queue = new PermissionQueueManager()
  queue.adminOriginator = 'admin.example.com'
  queue.permissionsConfig = {} as any
  const pm = queue.createPermissionsManager({ keyDeriver: new KeyDeriver(new EcpmTestPrivateKey(17)) } as any)
  expect(pm).toBeInstanceOf(WalletPermissionsManager)
  expect(pm.createAction).toBe(WalletPermissionsManager.prototype.createAction)
})
