/**
 * Rate-limited fetch queue with 429 retry/backoff.
 *
 * Caps outbound rate AND auto-retries on 429 with capped exponential backoff
 * plus jitter. Two failure modes this guards against:
 *  1. Discovery scans — a candidate address that's 429'd is silently treated
 *     as [] by the indexer client, so a real UTXO there is missed entirely.
 *  2. Registration — findCreateContractTxid (ancestry walk) and
 *     buildChainedAtomicBeef (proof chain) fetch rawTx/merkle proofs here as a
 *     fallback when wallet-toolbox's own (UNTHROTTLED) `services.getRawTx/
 *     getMerklePath` 429s. Those unthrottled primary calls are what push total
 *     WoC traffic over the limit, so the throttled fallback must be persistent
 *     enough to win — otherwise a freshly-discovered token fails to register
 *     and needs a manual register-by-txid.
 *
 * Honours `Retry-After` when present; otherwise backs off 1s, 2s, 4s, 8s, 8s, 8s
 * (capped) with ±25% jitter across up to `maxRetries` attempts before surfacing
 * the 429. The rate is deliberately below WoC's ceiling to leave headroom for
 * wallet-toolbox's concurrent (unthrottled) traffic.
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
  private maxRetries: number

  constructor(requestsPerSecond: number = 1.5, maxRetries: number = 6) {
    this.requestsPerSecond = requestsPerSecond
    this.minInterval = 1000 / requestsPerSecond
    this.maxRetries = maxRetries
  }

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
      this.queue.push({ url, options, resolve, reject })
      if (!this.processing) {
        this.processQueue()
      }
    })
  }

  private async fetchWithRetry(url: string, options?: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const res = await fetch(url, options)
      if (res.status !== 429) return res
      if (attempt === this.maxRetries) return res
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '', 10)
      // Capped exponential (1s,2s,4s,8s,8s,…) + ±25% jitter so concurrent
      // retries don't thunder back in lockstep. Retry-After wins when present.
      const base = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(8000, 1000 * Math.pow(2, attempt))
      const backoff = base + Math.floor(base * 0.25 * Math.random())
      await new Promise((r) => setTimeout(r, backoff))
    }
    return fetch(url, options)
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
      const response = await this.fetchWithRetry(item.url, item.options)
      item.resolve(response)
    } catch (error) {
      item.reject(error as Error)
    }

    const elapsed = Date.now() - startTime
    const delay = Math.max(0, this.minInterval - elapsed)

    setTimeout(() => {
      this.processQueue()
    }, delay)
  }
}

// Singleton for WhatsOnChain / Bitails API calls. 1.5 req/s leaves headroom
// for wallet-toolbox's own concurrent (unthrottled) WoC traffic, and 429s
// auto-retry with capped backoff across up to 6 attempts so registration
// fetches win under sustained pressure instead of failing to null.
export const wocFetch = new RateLimitedFetch(1.5, 6)
