/** All main-process requests for a wallet drain before its database is switched.
 * A closed generation stays fenced until the application restarts.
 *
 * `run` is exclusive and FIFO. `share` is for everyday storage requests: they
 * run concurrently with each other, wait for any queued exclusive operation,
 * and are drained before the next exclusive operation starts. */
export class WalletStorageAccess {
  private tail: Promise<void> = Promise.resolve()
  private exclusiveQueued = 0
  private inFlight = new Set<Promise<unknown>>()
  private closed = false
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>(resolve => { release = resolve })
    this.exclusiveQueued++
    try {
      await previous
      if (this.inFlight.size > 0) await Promise.allSettled(this.inFlight)
      if (this.closed) throw new Error('Wallet storage changed. Restart the wallet to continue.')
      return await operation()
    } finally { this.exclusiveQueued--; release() }
  }
  async share<T>(operation: () => Promise<T>): Promise<T> {
    while (this.exclusiveQueued > 0) await this.tail
    if (this.closed) throw new Error('Wallet storage changed. Restart the wallet to continue.')
    // Registered synchronously so an exclusive operation queued later drains it.
    const pending = (async () => await operation())()
    this.inFlight.add(pending)
    try { return await pending } finally { this.inFlight.delete(pending) }
  }
  /** Fence this generation. An operation that fails before calling `seal`
   * leaves storage usable; once sealed (or completed) it stays fenced. */
  async close(operation: (seal: () => void) => Promise<void>): Promise<void> {
    await this.run(async () => {
      await operation(() => { this.closed = true })
      this.closed = true
    })
  }
}
