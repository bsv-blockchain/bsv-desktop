/**
 * TokenProtocolRegistry — holds every TokenProtocolAdapter the wallet
 * knows about. The renderer accesses it through `stas.tokens` on the
 * WalletService bundle.
 *
 * Lookup order matters for `find(scriptHex)`: the registry asks each
 * adapter to try parsing the script in registration order and returns
 * the first that succeeds. STAS adapters are registered before DSTAS
 * to preserve the existing precedence — classic STAS's prefix sniff is
 * cheap and unambiguous, so checking it first short-circuits the more
 * expensive DSTAS reader.
 */

import type {
  TokenProtocolAdapter,
  TokenProtocolId,
  ParseContext,
  ParsedTokenOutput,
} from './TokenProtocolAdapter';

export interface AdapterMatch {
  adapter: TokenProtocolAdapter;
  parsed: ParsedTokenOutput;
}

export class TokenProtocolRegistry {
  private readonly adapters: TokenProtocolAdapter[] = [];

  register(adapter: TokenProtocolAdapter): void {
    if (this.adapters.some((a) => a.id === adapter.id)) {
      throw new Error(`TokenProtocolRegistry: adapter "${adapter.id}" already registered`);
    }
    this.adapters.push(adapter);
  }

  all(): readonly TokenProtocolAdapter[] {
    return this.adapters;
  }

  getById(id: TokenProtocolId): TokenProtocolAdapter | undefined {
    return this.adapters.find((a) => a.id === id);
  }

  /**
   * Walk every registered adapter and return the first whose
   * `parseOutput` recognises the script. Returns `null` if no adapter
   * claims it (foreign script — not one of our tokens).
   */
  async find(scriptHex: string, ctx?: ParseContext): Promise<AdapterMatch | null> {
    for (const adapter of this.adapters) {
      try {
        const parsed = await adapter.parseOutput(scriptHex, ctx);
        if (parsed) return { adapter, parsed };
      } catch {
        // Adapters must not throw on non-matching scripts; if one does,
        // treat it as "did not match" and move on.
      }
    }
    return null;
  }
}
