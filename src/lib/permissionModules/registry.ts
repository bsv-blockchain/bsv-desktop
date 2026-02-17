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

  return {
    registry,
    getPermissionModuleById,
    getDefaultEnabledPermissionModules,
    normalizeEnabledPermissionModules
  }
}
