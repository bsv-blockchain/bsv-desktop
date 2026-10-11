/** A tiny "one at a time" guard: tryStart() succeeds only when nothing is running. */
export interface SingleFlight { tryStart(): boolean; finish(): void; readonly busy: boolean }

export function createSingleFlight(): SingleFlight {
  let busy = false
  return {
    tryStart() { if (busy) return false; busy = true; return true },
    finish() { busy = false },
    get busy() { return busy },
  }
}
