import parseAppManifest from './parseAppManifest'

export interface AppDataCache {
  appName: string
  appIconImageUrl?: string
  timestamp: number
  domain: string
}

export interface OptimizedAppData {
  appName: string
  appIconImageUrl?: string
  domain: string
  isPinned?: boolean
}

// Utility function to format domain names consistently
function formatDomain(domain: string): string {
  let formatted = domain
  if (domain.startsWith('https://')) {
    formatted = domain.substring(8)
  }
  if (domain.startsWith('http://')) {
    formatted = domain.substring(7)
  }
  return formatted
}

// Check if a URL points to a valid image
async function isImageUrl(url: string, timeout = 1500): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'force-cache'
    })
    
    clearTimeout(timeoutId)
    
    return response.ok && response.headers.get('content-type')?.startsWith('image/') === true
  } catch {
    return false
  }
}

class OptimizedAppDataFetcher {
  private cache = new Map<string, AppDataCache>()
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours
  private readonly CACHE_KEY = 'optimized_app_cache'
  private readonly REQUEST_TIMEOUT = 1500

  constructor() {
    this.loadCache()
  }

  private loadCache(): void {
    try {
      const cached = localStorage.getItem(this.CACHE_KEY)
      if (cached) {
        const data = JSON.parse(cached)
        Object.entries(data).forEach(([domain, cacheData]) => {
          this.cache.set(domain, cacheData as AppDataCache)
        })
      }
    } catch (error) {
      console.warn('Failed to load app data cache:', error)
    }
  }

  private saveCache(): void {
    try {
      const cacheObject = Object.fromEntries(this.cache.entries())
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(cacheObject))
    } catch (error) {
      console.warn('Failed to save app data cache:', error)
    }
  }

  private isCacheValid(cacheData: AppDataCache): boolean {
    return Date.now() - cacheData.timestamp < this.CACHE_DURATION
  }

  private async fetchAppIcon(domain: string): Promise<string | undefined> {
    const formattedDomain = formatDomain(domain)
    
    // Try favicon.ico first as it's most common
    const faviconUrl = `https://${formattedDomain}/favicon.ico`
    if (await isImageUrl(faviconUrl, this.REQUEST_TIMEOUT)) {
      return faviconUrl
    }
    
    // Could add more fallbacks here (apple-touch-icon, etc.) if needed
    return undefined
  }

  private async fetchAppData(domain: string): Promise<AppDataCache> {
    const formattedDomain = formatDomain(domain)
    const timestamp = Date.now()
    
    // Fetch manifest and icon in parallel
    const [manifestResult, iconResult] = await Promise.allSettled([
      parseAppManifest({ domain }),
      this.fetchAppIcon(domain)
    ])
    
    // Extract app name from manifest or use domain as fallback
    let appName = formattedDomain
    let manifestIconUrl: string | undefined
    
    if (manifestResult.status === 'fulfilled' && manifestResult.value) {
      const manifest = manifestResult.value
      if (typeof manifest.name === 'string' && manifest.name.trim()) {
        appName = manifest.name.trim()
      }
      // Check if manifest specifies an icon
      if (typeof manifest.iconImageUrl === 'string' && manifest.iconImageUrl.trim()) {
        manifestIconUrl = manifest.iconImageUrl.trim()
      }
    }
    
    // Prioritize manifest icon over favicon
    const appIconImageUrl = manifestIconUrl || 
      (iconResult.status === 'fulfilled' ? iconResult.value : undefined)

    const cacheData: AppDataCache = {
      appName,
      appIconImageUrl,
      timestamp,
      domain
    }

    this.cache.set(domain, cacheData)
    this.saveCache()
    
    return cacheData
  }

  async getAppData(domain: string): Promise<OptimizedAppData> {
    const formattedDomain = formatDomain(domain)
    const cached = this.cache.get(domain)
    
    // Return cached data if valid
    if (cached && this.isCacheValid(cached)) {
      return {
        appName: cached.appName,
        appIconImageUrl: cached.appIconImageUrl,
        domain
      }
    }
    
    // Fetch fresh data
    try {
      const freshData = await this.fetchAppData(domain)
      return {
        appName: freshData.appName,
        appIconImageUrl: freshData.appIconImageUrl,
        domain
      }
    } catch (error) {
      console.warn(`Failed to fetch data for ${domain}:`, error)
      // Return fallback on error
      return {
        appName: formattedDomain,
        domain
      }
    }
  }

  async *getAppDataBatch(domains: string[]): AsyncGenerator<OptimizedAppData[], void, unknown> {
    const BATCH_SIZE = 5
    
    // Process domains in batches
    for (let i = 0; i < domains.length; i += BATCH_SIZE) {
      const batch = domains.slice(i, i + BATCH_SIZE)
      
      const batchResults = await Promise.allSettled(
        batch.map(domain => this.getAppData(domain))
      )
      
      const apps: OptimizedAppData[] = batchResults
        .map((result, index) => {
          if (result.status === 'fulfilled') {
            return result.value
          } else {
            // Fallback for failed requests
            const domain = batch[index]
            return {
              appName: formatDomain(domain),
              domain
            }
          }
        })
      
      yield apps
    }
  }

  clearCache(): void {
    this.cache.clear()
    localStorage.removeItem(this.CACHE_KEY)
  }

  // Get all cached apps that are still valid
  getCachedApps(): OptimizedAppData[] {
    const validApps: OptimizedAppData[] = []
    
    for (const [domain, cacheData] of this.cache.entries()) {
      if (this.isCacheValid(cacheData)) {
        validApps.push({
          appName: cacheData.appName,
          appIconImageUrl: cacheData.appIconImageUrl,
          domain
        })
      }
    }
    
    return validApps
  }
}

export default OptimizedAppDataFetcher
