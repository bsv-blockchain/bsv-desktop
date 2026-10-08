import type { PermissionModuleDefinition } from './types'

export const buildPermissionModuleRegistry = (modules: PermissionModuleDefinition[]) => {
  const registry = modules ?? []
  const registryById = new Map(registry.map(module => [module.id, module]))

  const getPermissionModuleById = (id: string) => registryById.get(id)
  const getDefaultEnabledPermissionModules = () =>
    registry
      .filter(module => module.enabledByDefault !== false)
      .map(module => module.id)

  const normalizeEnabledPermissionModules = (ids?: string[]) => {
    const defaults = getDefaultEnabledPermissionModules()
    if (!Array.isArray(ids)) {
      return defaults
    }

    return ids.filter(id => registryById.has(id))
  }

  // The settings UI no longer offers a way to disable a module, so a saved
  // list can only ever lose a default module by accident (e.g. a build that
  // did not ship it normalized it away, which then left Mandala calls failing
  // with "Unsupported P-module scheme: p mandala"). Default-enabled modules are
  // therefore always restored; `knownIds` is kept for signature compatibility.
  const restoreEnabledPermissionModules = (ids?: string[], _knownIds?: string[]) => {
    const enabled = normalizeEnabledPermissionModules(ids)
    return [...new Set([...enabled, ...getDefaultEnabledPermissionModules()])]
  }

  return {
    registry,
    getPermissionModuleById,
    getDefaultEnabledPermissionModules,
    normalizeEnabledPermissionModules,
    restoreEnabledPermissionModules
  }
}
