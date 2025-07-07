import { WalletInterface } from '@bsv/sdk'

interface GetAppsParams {
  limit?: number
  offset?: number
  permissionsManager: WalletInterface
  adminOriginator: string
}

interface AppDomainCache {
  domains: string[]
  timestamp: number
}

const DOMAIN_CACHE_KEY = 'app_domains_cache'
const DOMAIN_CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export const getAppsOptimized = async ({
  limit = 1000,
  offset = 0,
  permissionsManager,
  adminOriginator
}: GetAppsParams): Promise<string[]> => {
  try {
    // Check cache first
    const cached = getCachedDomains()
    if (cached && isCacheValid(cached)) {
      return cached.domains
    }

    // Fetch app permissions
    const { outputs } = await permissionsManager.listOutputs({
      basket: 'admin protocol-permission',
      includeTags: true,
      includeLabels: false,
      limit: Math.min(limit, 1000),
      offset
    }, adminOriginator)

    // Extract unique domains from originator tags
    const domainSet = new Set<string>()

    for (const output of outputs) {
      if (output.tags?.length) {
        for (const tag of output.tags) {
          if (tag.startsWith('originator ')) {
            const domain = tag.substring(11)
            domainSet.add(domain)
            break
          }
        }
      }
    }

    const domains = Array.from(domainSet)
    cacheDomains(domains)
    return domains
  } catch (error) {
    console.error('Error fetching app domains:', error)
    const cached = getCachedDomains()
    return cached?.domains || []
  }
}

function getCachedDomains(): AppDomainCache | null {
  try {
    const cached = localStorage.getItem(DOMAIN_CACHE_KEY)
    return cached ? JSON.parse(cached) : null
  } catch (error) {
    console.warn('Failed to load cached domains:', error)
    return null
  }
}

function isCacheValid(cache: AppDomainCache): boolean {
  return Date.now() - cache.timestamp < DOMAIN_CACHE_DURATION
}

function cacheDomains(domains: string[]): void {
  try {
    const cacheData: AppDomainCache = {
      domains,
      timestamp: Date.now()
    }
    localStorage.setItem(DOMAIN_CACHE_KEY, JSON.stringify(cacheData))
  } catch (error) {
    console.warn('Failed to cache domains:', error)
  }
}

export default getAppsOptimized
