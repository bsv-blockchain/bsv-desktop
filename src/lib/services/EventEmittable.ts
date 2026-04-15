/**
 * Minimal typed event emitter base class.
 * All service classes extend this to provide observable state without React dependency.
 */

type EventMap = Record<string, any>
type Handler<T> = T extends void ? () => void : (payload: T) => void

export class EventEmittable<Events extends EventMap> {
  private _listeners: Partial<{ [K in keyof Events]: Array<Handler<Events[K]>> }> = {}

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): this {
    if (!this._listeners[event]) {
      this._listeners[event] = []
    }
    this._listeners[event]!.push(handler)
    return this
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): this {
    const handlers = this._listeners[event]
    if (handlers) {
      this._listeners[event] = handlers.filter(h => h !== handler) as any
    }
    return this
  }

  protected emit<K extends keyof Events>(
    event: K,
    ...args: Events[K] extends void ? [] : [Events[K]]
  ): void {
    const handlers = this._listeners[event]
    if (handlers) {
      for (const handler of handlers.slice()) {
        ;(handler as any)(...args)
      }
    }
  }
}
