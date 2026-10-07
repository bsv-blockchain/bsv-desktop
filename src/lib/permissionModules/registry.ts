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

  // Before registry tracking, BTMS was the only shipped module. Its absence
  // in a saved list remains a disable choice; newly shipped defaults are added.
  const restoreEnabledPermissionModules = (ids?: string[], knownIds?: string[]) => {
    const enabled = normalizeEnabledPermissionModules(ids)
    if (!Array.isArray(ids)) return enabled
    const known = new Set(Array.isArray(knownIds) ? knownIds : ['btms'])
    return [...new Set([...enabled, ...getDefaultEnabledPermissionModules().filter(id => !known.has(id))])]
  }

  return {
    registry,
    getPermissionModuleById,
    getDefaultEnabledPermissionModules,
    normalizeEnabledPermissionModules,
    restoreEnabledPermissionModules
  }
}
