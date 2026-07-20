/**
 * STAS query layer.
 *
 * A thin, parameterized accessor over the STAS extension tables created by
 * electron/stas-migrations. It is reached from the renderer through the
 * dedicated `stas:query` IPC channel (see electron/main.ts + preload.ts),
 * kept separate from wallet-toolbox's `storage:call-method` proxy so STAS
 * queries never share the StorageKnex method namespace.
 *
 * `knex` is typed `any` (tsconfig.electron has strict:false) to avoid a direct
 * knex type dependency.
 */

/** Token-protocol discriminator. Mirrors TokenProtocolId in the renderer. */
export type TokenProtocolId = 'stas' | 'dstas' | 'bsv-21';

export interface StasTokenRow {
  tokenId: string;
  symbol: string;
  name?: string;
  satoshisPerToken: number;
  freezeEnabled: boolean;
  confiscationEnabled: boolean;
  redemptionPkh?: string;
  issuerIdentityKey?: string;
  flagsHex?: string;
  createdAt: string;
  /** Optional on insert — the column has a DEFAULT 'stas' (migration 0002). */
  protocol?: TokenProtocolId;
}

export interface StasOutputRow {
  outputId: number;
  tokenId: string;
  brc42KeyId?: string;
  ownerFieldHash160: string;
  tokenSatoshis: number;
  frozen?: boolean;
  confiscated?: boolean;
  serviceFieldsJson?: string;
  createdAt: string;
  updatedAt: string;
  /** Optional on insert — the column has a DEFAULT 'stas' (migration 0002). */
  protocol?: TokenProtocolId;
}

/** A persisted Back-to-Genesis verdict for one token outpoint (migration 0004). */
export interface TokenVerificationRow {
  txid: string;
  vout: number;
  protocol: TokenProtocolId;
  /** Only settled verdicts are stored. */
  result: 'authentic' | 'not-authentic';
  /** Resolved genesis `<txid>_<vout>`; null/undefined when none was resolved. */
  genesis?: string | null;
  genesisDepth?: number | null;
  /** Present when `not-authentic`. */
  reason?: string | null;
  /** ISO timestamp of when the verdict was recorded. */
  verifiedAt: string;
}

export interface StasReceiveContextRow {
  profileIdentityKey: string;
  keyIndex: number;
  keyId: string;
  ownerFieldHash160: string;
  derivedPublicKey: string;
  createdAt: string;
}

/**
 * BSV-21 receive-key row. Schema identical to the STAS variant, but lives
 * in its own table (`bsv21_receive_contexts`, migration 0003) so the
 * receive-key namespace and high-water mark stay separate per protocol.
 */
export interface Bsv21ReceiveContextRow {
  profileIdentityKey: string;
  keyIndex: number;
  keyId: string;
  ownerFieldHash160: string;
  derivedPublicKey: string;
  createdAt: string;
}

/** Query/command surface over the STAS extension tables. */
export class StasQueries {
  constructor(private readonly knex: any) {}

  // --- tokens -------------------------------------------------------------

  async getStasToken(tokenId: string): Promise<StasTokenRow | undefined> {
    return this.knex('stas_tokens').where({ tokenId }).first();
  }

  async listStasTokens(): Promise<StasTokenRow[]> {
    return this.knex('stas_tokens').select('*');
  }

  async upsertStasToken(row: StasTokenRow): Promise<void> {
    const existing = await this.knex('stas_tokens')
      .where({ tokenId: row.tokenId })
      .first();
    if (existing) {
      await this.knex('stas_tokens').where({ tokenId: row.tokenId }).update(row);
    } else {
      await this.knex('stas_tokens').insert(row);
    }
  }

  // --- outputs ------------------------------------------------------------

  /**
   * STAS outputs the wallet STILL OWNS — joins our satellite to the wallet-
   * toolbox `outputs` row and filters by `spentBy IS NULL`.
   *
   * wallet-toolbox's spend lifecycle:
   *   - own + available  →  spendable=1, spentBy=NULL
   *   - in-flight spend  →  spendable=0, spentBy=<txid>
   *   - finalised spend  →  spendable=0, spentBy=<txid>
   *   - unspent revert   →  spendable=1, spentBy=NULL (set by wallet-toolbox
   *                          when the spending tx fails to confirm)
   *
   * Filter on `spentBy IS NULL` rather than `spendable=1` because we
   * deliberately set `spendable=1` on STAS at register-time (the toolbox
   * conservatively defaults it to 0 for non-template scripts). `spentBy`
   * is the unambiguous "this is gone" signal.
   *
   * Pass `includeSpent: true` to surface fully sent STAS too (for history /
   * activity views — not exposed via the Apps API by default).
   */
  async listStasOutputs(filter: {
    tokenId?: string;
    includeSpent?: boolean;
  } = {}): Promise<any[]> {
    // `outputs.spentBy` is an integer FK → `transactions.transactionId`, not
    // a txid string. Join `transactions` so we return the actual spending
    // txid the UI can render / link to WhatsOnChain. NULL when unspent.
    let q = this.knex('stas_outputs')
      .join('outputs', 'outputs.outputId', 'stas_outputs.outputId')
      .leftJoin('transactions as spent_tx', 'spent_tx.transactionId', 'outputs.spentBy')
      // Symbol/name live on stas_tokens (keyed by tokenId), not stas_outputs, so
      // without this join every holding reaches the UI symbol-less and the token
      // selector can't tell two STAS/DSTAS holdings apart. leftJoin so an output
      // whose token row is somehow missing still returns.
      .leftJoin('stas_tokens', 'stas_tokens.tokenId', 'stas_outputs.tokenId')
      .select(
        'stas_outputs.*',
        'outputs.satoshis as outputSatoshis',
        'outputs.spendable',
        'spent_tx.txid as spentBy',
        'outputs.txid',
        'outputs.vout',
        'outputs.lockingScript', // bytes — converted to hex below for the transfer UI
        'stas_tokens.symbol as symbol',
        'stas_tokens.name as name'
      );
    if (filter.tokenId) q = q.where('stas_outputs.tokenId', filter.tokenId);
    if (!filter.includeSpent) q = q.whereNull('outputs.spentBy');
    const rows = await q;
    // outputs.lockingScript is stored as Buffer in SQLite (BLOB). Convert to
    // hex so renderer-side consumers (Transfer UI) get a usable string.
    return rows.map((r: any) => ({
      ...r,
      lockingScript:
        r.lockingScript == null
          ? undefined
          : Buffer.isBuffer(r.lockingScript)
            ? r.lockingScript.toString('hex')
            : typeof r.lockingScript === 'string'
              ? r.lockingScript
              : Buffer.from(r.lockingScript).toString('hex'),
    }));
  }

  async insertStasOutput(row: StasOutputRow): Promise<void> {
    await this.knex('stas_outputs').insert(row);
  }

  /**
   * Persist a settled Back-to-Genesis verdict for one outpoint (migration
   * 0004). Standard-agnostic — STAS/DSTAS/BSV-21 all use it. Callers must pass
   * only SETTLED verdicts (`authentic` / `not-authentic`); an `undetermined`
   * result means "couldn't decide yet" and must be retried, never stored.
   * Idempotent upsert keyed on the outpoint (re-verifying overwrites).
   */
  async upsertTokenVerification(row: TokenVerificationRow): Promise<void> {
    const existing = await this.knex('token_verifications')
      .where({ txid: row.txid, vout: row.vout })
      .first();
    if (existing) {
      await this.knex('token_verifications')
        .where({ txid: row.txid, vout: row.vout })
        .update(row);
    } else {
      await this.knex('token_verifications').insert(row);
    }
  }

  /** Every stored verdict — the renderer seeds its badge state from this. */
  async listTokenVerifications(): Promise<TokenVerificationRow[]> {
    return this.knex('token_verifications').select('*');
  }

  /**
   * Mark a wallet-toolbox `outputs` row as spendable / not-spendable.
   *
   * STAS outputs land in the basket with `spendable=false` because the
   * toolbox doesn't recognise the custom locking script as one it knows how
   * to unlock. Our transfer flow handles the unlocking externally via the
   * BRC-42 sign path, so we need to flip the flag back to `true` so
   * createAction will let us reference the outpoint as an input.
   */
  async setOutputSpendable(outputId: number, spendable: boolean): Promise<{ updated: number }> {
    const updated = await this.knex('outputs')
      .where({ outputId })
      .update({ spendable: spendable ? 1 : 0 });
    return { updated };
  }

  /**
   * Backfill: flip `outputs.spendable=1` on the given basket's UTXOs that
   * the wallet still owns. Critical guard: only updates rows where
   * `spentBy IS NULL` so we don't resurrect already-spent UTXOs.
   *
   * Generalised in PR-token-adapters so each protocol (STAS, DSTAS,
   * later BSV-21) can backfill its own basket. `backfillStasSpendable`
   * stays as a thin wrapper for the STAS basket.
   */
  async backfillSpendableForBasket(basketName: string): Promise<{ updated: number }> {
    const basket = await this.knex('output_baskets')
      .where({ name: basketName, isDeleted: 0 })
      .first('basketId');
    if (!basket) return { updated: 0 };
    const updated = await this.knex('outputs')
      .where({ basketId: basket.basketId })
      .andWhere({ spendable: 0 })
      .whereNull('spentBy')
      .update({ spendable: 1 });
    return { updated };
  }

  /**
   * Back-compat shim — classic-STAS basket backfill. New callers should
   * use `backfillSpendableForBasket` with the protocol-specific basket
   * name from `src/lib/constants/baskets`.
   */
  async backfillStasSpendable(): Promise<{ updated: number }> {
    return this.backfillSpendableForBasket('stas-tokens');
  }

  /**
   * Override the `default` (change) basket's `numberOfDesiredUTXOs`.
   *
   * Wallet-toolbox's `generateChange` aims for this many UTXOs in the change
   * basket; below the target it adds fragmentation outputs each createAction.
   * The STAS engine assumes exactly 2 outputs (new STAS + one change), so
   * we lower the target to 0 around a STAS transfer to suppress
   * fragmentation, then restore it afterward.
   *
   * Returns previous + new values so the caller can restore.
   */
  async setDefaultBasketUTXOTarget(target: number): Promise<{
    previous: number | null;
    updated: number;
  }> {
    const before = await this.knex('output_baskets')
      .where({ name: 'default' })
      .first('numberOfDesiredUTXOs');
    const updated = await this.knex('output_baskets')
      .where({ name: 'default' })
      .update({ numberOfDesiredUTXOs: target });
    return {
      previous: before?.numberOfDesiredUTXOs ?? null,
      updated,
    };
  }

  /**
   * Enumerate every basket the wallet knows about, with output counts.
   *
   * BRC-100's `listOutputs` requires a basket name upfront — there's no
   * "give me every basket" method on the wallet surface. We query the
   * toolbox's `output_baskets` table directly and join `outputs` for
   * counts/totals.
   */
  async listAllBaskets(): Promise<
    Array<{
      basketId: number;
      name: string;
      numberOfDesiredUTXOs: number | null;
      minimumDesiredUTXOValue: number | null;
      outputCount: number;
      spendableCount: number;
      totalSatoshis: number;
    }>
  > {
    const baskets = await this.knex('output_baskets')
      .where({ isDeleted: 0 })
      .select(
        'basketId',
        'name',
        'numberOfDesiredUTXOs',
        'minimumDesiredUTXOValue'
      );
    if (baskets.length === 0) return [];

    const counts = await this.knex('outputs')
      .whereIn(
        'basketId',
        baskets.map((b: any) => b.basketId)
      )
      .groupBy('basketId')
      .select(
        'basketId',
        this.knex.raw('COUNT(*) as outputCount'),
        this.knex.raw('SUM(CASE WHEN spendable = 1 THEN 1 ELSE 0 END) as spendableCount'),
        this.knex.raw('SUM(satoshis) as totalSatoshis')
      );

    const byId = new Map<number, any>();
    for (const c of counts) byId.set(c.basketId, c);

    return baskets.map((b: any) => ({
      basketId: b.basketId,
      name: b.name,
      numberOfDesiredUTXOs: b.numberOfDesiredUTXOs ?? null,
      minimumDesiredUTXOValue: b.minimumDesiredUTXOValue ?? null,
      outputCount: byId.get(b.basketId)?.outputCount ?? 0,
      spendableCount: byId.get(b.basketId)?.spendableCount ?? 0,
      totalSatoshis: byId.get(b.basketId)?.totalSatoshis ?? 0,
    }));
  }

  /**
   * Outputs inside a specific basket. Returns satellite-friendly fields:
   * outpoint, satoshis, lockingScript (hex), spendable, customInstructions,
   * tags (semicolon-joined if present on the row).
   */
  async listBasketOutputs(basketName: string): Promise<any[]> {
    const basket = await this.knex('output_baskets')
      .where({ name: basketName, isDeleted: 0 })
      .first('basketId');
    if (!basket) return [];
    // wallet-toolbox stores `txid` on `transactions`, not `outputs` — outputs
    // carries `transactionId` as a foreign key. Join to surface the real txid.
    const rows = await this.knex('outputs as o')
      .join('transactions as t', 't.transactionId', 'o.transactionId')
      .where('o.basketId', basket.basketId)
      .select(
        'o.outputId as outputId',
        't.txid as txid',
        'o.vout as vout',
        'o.satoshis as satoshis',
        'o.spendable as spendable',
        'o.lockingScript as lockingScript',
        'o.customInstructions as customInstructions',
        'o.type as type',
        'o.created_at as createdAt'
      )
      .orderBy('o.created_at', 'desc')
      .limit(500);

    return rows.map((r: any) => ({
      outputId: r.outputId,
      outpoint: r.txid != null ? `${r.txid}.${r.vout}` : `?.${r.vout}`,
      txid: r.txid ?? null,
      vout: r.vout,
      satoshis: r.satoshis,
      spendable: !!r.spendable,
      type: r.type,
      customInstructions: r.customInstructions ?? null,
      lockingScript:
        r.lockingScript == null
          ? null
          : Buffer.isBuffer(r.lockingScript)
            ? r.lockingScript.toString('hex')
            : typeof r.lockingScript === 'string'
              ? r.lockingScript
              : Buffer.from(r.lockingScript).toString('hex'),
      createdAt: r.createdAt,
    }));
  }

  /** Idempotency probe: has an outpoint already been registered as STAS? */
  async findStasOutputByOutpoint(
    txid: string,
    vout: number
  ): Promise<StasOutputRow | undefined> {
    return this.knex('stas_outputs')
      .join('outputs', 'outputs.outputId', 'stas_outputs.outputId')
      .where({ 'outputs.txid': txid, 'outputs.vout': vout })
      .first('stas_outputs.*');
  }

  /**
   * Look up wallet-toolbox's `outputs.outputId` for an outpoint — used after
   * internalizeAction to link a satellite `stas_outputs` row to the
   * authoritative UTXO row.
   */
  async findOutputIdByOutpoint(
    txid: string,
    vout: number
  ): Promise<number | undefined> {
    const row = await this.knex('outputs')
      .where({ txid, vout })
      .first('outputId');
    return row ? (row.outputId as number) : undefined;
  }

  async updateStasOutputState(
    outputId: number,
    state: { frozen?: boolean; confiscated?: boolean }
  ): Promise<void> {
    await this.knex('stas_outputs')
      .where({ outputId })
      .update({ ...state, updatedAt: new Date().toISOString() });
  }

  /**
   * Backfill helper — assign a freshly-derived tokenId (+ symbol/flags) to
   * an existing stas_outputs row, and upsert the matching stas_tokens row.
   *
   * Used by the dev panel's "Backfill tokenIds" button, which re-derives the
   * CreateContract txid for STAS that were registered before the
   * findCreateContractTxid helper existed (so they have empty or stale
   * tokenId values).
   *
   * Order matters: stas_outputs.tokenId has a FOREIGN KEY to
   * stas_tokens.tokenId. We must insert the parent row FIRST and only then
   * update the satellite's FK column.
   */
  async updateStasOutputAndToken(args: {
    outputId: number;
    tokenId: string;
    symbol?: string;
    flagsHex?: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    // 1) Ensure the stas_tokens row exists (insert if new, update symbol if
    //    it changed). Either way, the FK target is ready before step 2.
    const existing = await this.knex('stas_tokens')
      .where({ tokenId: args.tokenId })
      .first();
    if (!existing) {
      await this.knex('stas_tokens').insert({
        tokenId: args.tokenId,
        symbol: args.symbol ?? 'STAS',
        name: null,
        satoshisPerToken: 1,
        freezeEnabled: false,
        confiscationEnabled: false,
        redemptionPkh: null,
        issuerIdentityKey: null,
        flagsHex: args.flagsHex ?? null,
        createdAt: now,
      });
    } else if (args.symbol && existing.symbol !== args.symbol) {
      await this.knex('stas_tokens')
        .where({ tokenId: args.tokenId })
        .update({ symbol: args.symbol });
    }
    // 2) Now safely update the satellite row.
    await this.knex('stas_outputs')
      .where({ outputId: args.outputId })
      .update({ tokenId: args.tokenId, updatedAt: now });
  }

  /**
   * Retroactively assign a basket + customInstructions + tags to an
   * existing output. Used for BSV-21 orphan recovery — pre-fix sends
   * produced change outputs in the `outputs` table with `basketId = NULL`
   * (the toolbox doesn't recognise the token template, so the
   * createAction output never claimed a basket). The recovery flow
   * re-classifies them after the fact.
   *
   * Idempotent: if the output already has a basket, returns without
   * modifying it. The output's `userId` is read from the existing row,
   * so we never have to guess which user the tags belong to.
   *
   * Returns the outputId on success so the caller can log it. Reason
   * field surfaces lookup misses without throwing.
   */
  async recoverOrphanOutput(args: {
    txid: string;
    vout: number;
    customInstructions: string;
    tags: string[];
    basketName: string;
  }): Promise<{
    ok: boolean;
    outputId?: number;
    alreadyHadBasket?: boolean;
    reason?: string;
  }> {
    const row = await this.knex('outputs')
      .where({ txid: args.txid, vout: args.vout })
      .first('outputId', 'userId', 'basketId');
    if (!row) {
      return { ok: false, reason: `no outputs row matches ${args.txid}:${args.vout}` };
    }
    const { outputId, userId, basketId } = row;
    if (basketId) {
      return { ok: true, outputId, alreadyHadBasket: true };
    }

    const basket = await this.knex('output_baskets')
      .where({ name: args.basketName, isDeleted: 0 })
      .first('basketId');
    if (!basket) {
      // Defensive — the basket should exist already, since the wallet
      // creates it on first BSV-21 internalize. If it doesn't, surface
      // the gap rather than silently creating an orphan basket row.
      return { ok: false, outputId, reason: `basket "${args.basketName}" not found — has it ever been used?` };
    }

    await this.knex('outputs')
      .where({ outputId })
      .update({
        basketId: basket.basketId,
        customInstructions: args.customInstructions,
        spendable: true,
      });

    const now = new Date().toISOString();
    for (const tag of args.tags) {
      let tagRow = await this.knex('output_tags')
        .where({ tag, userId })
        .first('outputTagId');
      if (!tagRow) {
        const [outputTagId] = await this.knex('output_tags').insert({
          tag,
          userId,
          isDeleted: false,
          created_at: now,
          updated_at: now,
        });
        tagRow = { outputTagId };
      }
      // output_tags_map UNIQUE on (outputTagId, outputId) — use raw INSERT
      // OR IGNORE so repeated calls are safe.
      const existing = await this.knex('output_tags_map')
        .where({ outputTagId: tagRow.outputTagId, outputId })
        .first();
      if (!existing) {
        await this.knex('output_tags_map').insert({
          outputTagId: tagRow.outputTagId,
          outputId,
          isDeleted: false,
          created_at: now,
          updated_at: now,
        });
      }
    }

    return { ok: true, outputId };
  }

  // --- receive contexts ---------------------------------------------------

  async listReceiveContexts(
    profileIdentityKey: string
  ): Promise<StasReceiveContextRow[]> {
    return this.knex('stas_receive_contexts')
      .where({ profileIdentityKey })
      .orderBy('keyIndex', 'asc');
  }

  /** Highest issued receive-key index for a profile (0 if none) — the resync high-water mark. */
  async getReceiveHighWaterMark(profileIdentityKey: string): Promise<number> {
    const row = await this.knex('stas_receive_contexts')
      .where({ profileIdentityKey })
      .max('keyIndex as m')
      .first();
    return (row && row.m) || 0;
  }

  async insertReceiveContext(row: StasReceiveContextRow): Promise<void> {
    await this.knex('stas_receive_contexts').insert(row);
  }

  // --- BSV-21 receive contexts -------------------------------------------
  //
  // Mirror of the STAS receive-context API surface, scoped to its own table
  // so each protocol's key derivation stays independent.

  async listBsv21ReceiveContexts(
    profileIdentityKey: string
  ): Promise<Bsv21ReceiveContextRow[]> {
    return this.knex('bsv21_receive_contexts')
      .where({ profileIdentityKey })
      .orderBy('keyIndex', 'asc');
  }

  async getBsv21ReceiveHighWaterMark(profileIdentityKey: string): Promise<number> {
    const row = await this.knex('bsv21_receive_contexts')
      .where({ profileIdentityKey })
      .max('keyIndex as m')
      .first();
    return (row && row.m) || 0;
  }

  async insertBsv21ReceiveContext(row: Bsv21ReceiveContextRow): Promise<void> {
    await this.knex('bsv21_receive_contexts').insert(row);
  }

  // --- resync snapshot ----------------------------------------------------

  /**
   * Export every STAS-relevant row in a stable, fingerprint-friendly shape.
   * Used by the resync verification flow: take a snapshot pre-wipe, restore
   * the wallet from mnemonic, take another snapshot, diff the two.
   *
   * Includes a canonical sort so two exports of equivalent states produce
   * byte-identical JSON (handy for shell `diff`).
   */
  async exportStasState(profileIdentityKey: string): Promise<{
    tokens: any[];
    outputs: any[];
    receiveContexts: any[];
    profileIdentityKey: string;
    exportedAt: string;
  }> {
    const tokens = await this.knex('stas_tokens')
      .select(
        'tokenId',
        'symbol',
        'name',
        'satoshisPerToken',
        'freezeEnabled',
        'confiscationEnabled',
        'redemptionPkh',
        'issuerIdentityKey',
        'flagsHex'
      )
      .orderBy('tokenId', 'asc');

    const outputsRaw = await this.knex('stas_outputs as so')
      .join('outputs as o', 'o.outputId', 'so.outputId')
      .join('transactions as t', 't.transactionId', 'o.transactionId')
      .select(
        't.txid as txid',
        'o.vout as vout',
        'so.tokenId as tokenId',
        'so.brc42KeyId as brc42KeyId',
        'so.ownerFieldHash160 as ownerFieldHash160',
        'so.tokenSatoshis as tokenSatoshis',
        'so.frozen as frozen',
        'so.confiscated as confiscated',
        'o.spendable as spendable'
      )
      .orderBy('t.txid', 'asc')
      .orderBy('o.vout', 'asc');

    const outputs = outputsRaw.map((r: any) => ({
      txid: r.txid,
      vout: r.vout,
      tokenId: r.tokenId,
      brc42KeyId: r.brc42KeyId ?? null,
      ownerFieldHash160: r.ownerFieldHash160,
      tokenSatoshis: r.tokenSatoshis,
      frozen: !!r.frozen,
      confiscated: !!r.confiscated,
      spendable: !!r.spendable,
    }));

    const receiveContexts = await this.knex('stas_receive_contexts')
      .where({ profileIdentityKey })
      .select('keyIndex', 'keyId', 'ownerFieldHash160', 'derivedPublicKey')
      .orderBy('keyIndex', 'asc');

    return {
      tokens,
      outputs,
      receiveContexts,
      profileIdentityKey,
      exportedAt: new Date().toISOString(),
    };
  }
}
