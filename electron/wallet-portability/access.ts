/** All main-process requests for a wallet drain before its database is switched.
 * A closed generation stays fenced until the application restarts. */
export class WalletStorageAccess {
  private tail: Promise<void> = Promise.resolve()
  private closed = false
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
      if (this.closed) throw new Error('Wallet storage changed. Restart the wallet to continue.')
      return await operation()
    } finally { release() }
  }
  async close(operation: () => Promise<void>): Promise<void> {
    await this.run(async () => { this.closed = true; await operation() })
  }
}
