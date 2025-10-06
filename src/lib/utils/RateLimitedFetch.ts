/**
 * Rate-limited fetch queue to prevent overwhelming APIs
 * Limits requests to a maximum rate (default: 3 requests per second)
 */
class RateLimitedFetch {
  private queue: Array<{
    url: string
    options?: RequestInit
    resolve: (value: Response) => void
    reject: (error: Error) => void
  }> = []
  private processing = false
  private requestsPerSecond: number
  private minInterval: number

  constructor(requestsPerSecond: number = 3) {
    this.requestsPerSecond = requestsPerSecond
    this.minInterval = 1000 / requestsPerSecond
  }

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
      this.queue.push({ url, options, resolve, reject })
      if (!this.processing) {
        this.processQueue()
      }
    })
  }

  private async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false
      return
    }

    this.processing = true
    const item = this.queue.shift()!
    const startTime = Date.now()

    try {
      const response = await fetch(item.url, item.options)
      item.resolve(response)
    } catch (error) {
      item.reject(error as Error)
    }

    // Ensure minimum interval between requests
    const elapsed = Date.now() - startTime
    const delay = Math.max(0, this.minInterval - elapsed)

    setTimeout(() => {
      this.processQueue()
    }, delay)
  }
}

// Singleton instance for WhatsOnChain API calls
export const wocFetch = new RateLimitedFetch(3)
