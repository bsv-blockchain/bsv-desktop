/**
 * The wallet with `originator` supplied on every call that names none: the
 * @bsv/mandala lib calls e.g. `wallet.internalizeAction(args)`, and the
 * permissions manager needs an originator (the admin originator never prompts
 * for the host's own receipt). No imports: PermissionQueueManager uses it
 * without loading the color module or the lib.
 */
export function bindOriginator<W extends object> (wallet: W, originator: string): W {
  return new Proxy(wallet, {
    get (target, prop) {
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      return (args: unknown, given?: string) => value.call(target, args, given ?? originator)
    }
  })
}
