/**
 * STAS extension schema — migration 0002.
 *
 * Adds `protocol` to `stas_tokens` and `stas_outputs` so every satellite
 * row self-describes which protocol it belongs to ('stas', 'dstas', and
 * later 'bsv-21'). Until now, classic STAS and DSTAS UTXOs lived in the
 * same satellite tables and the same wallet-toolbox basket; they were
 * distinguished only by re-parsing their locking script.
 *
 * Three steps, all inside one transaction so partial failure leaves the
 * database in its pre-migration state:
 *   1. ADD COLUMN protocol DEFAULT 'stas' to stas_tokens + stas_outputs.
 *   2. Backfill: any stas_outputs row whose joined locking script does
 *      NOT start with the classic-STAS prefix `76a914…88ac69` is DSTAS.
 *      Flip its protocol to 'dstas' and stamp the joined token row too.
 *   3. Move every DSTAS output to a dedicated `dstas-tokens` basket
 *      (created lazily per user). Existing STAS outputs stay in
 *      `stas-tokens`. Future registrations route by protocol via the
 *      TokenProtocolAdapter layer.
 *
 * The prefix sniff is the same one StasDiscoveryService.tryParseClassicStasOwner
 * uses (`76a914` head, `88ac69` at offset 23-25). It's intentionally
 * cheap + dependency-free so the migration doesn't need to load the
 * dxs SDK from the Electron main bundle.
 */

const CLASSIC_STAS_PREFIX = '76a914';
const CLASSIC_STAS_ENGINE_MARKER = '88ac69';
const DSTAS_BASKET_NAME = 'dstas-tokens';

function looksLikeClassicStasHex(hex: string): boolean {
  return (
    typeof hex === 'string' &&
    hex.length >= 56 &&
    hex.startsWith(CLASSIC_STAS_PREFIX) &&
    hex.substring(46, 52) === CLASSIC_STAS_ENGINE_MARKER
  );
}

/** Convert a SQLite BLOB (Buffer) or hex string to lowercase hex. */
function toHex(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.toLowerCase();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  try {
    return Buffer.from(value as any).toString('hex');
  } catch {
    return '';
  }
}

export async function up(knex: any): Promise<void> {
  await knex.transaction(async (trx: any) => {
    // 1. Add the columns. Knex's alterTable handles SQLite's `ADD COLUMN`.
    const hasOutputsProto = await trx.schema.hasColumn('stas_outputs', 'protocol');
    if (!hasOutputsProto) {
      await trx.schema.alterTable('stas_outputs', (t: any) => {
        t.text('protocol').notNullable().defaultTo('stas');
        t.index(['protocol']);
      });
    }
    const hasTokensProto = await trx.schema.hasColumn('stas_tokens', 'protocol');
    if (!hasTokensProto) {
      await trx.schema.alterTable('stas_tokens', (t: any) => {
        t.text('protocol').notNullable().defaultTo('stas');
      });
    }

    // 2. Identify DSTAS rows by sniffing each output's locking script.
    //    Anything in stas_outputs is one of the two protocols by
    //    construction — if it isn't classic, it must be DSTAS.
    const rows: Array<{
      outputId: number;
      tokenId: string;
      lockingScript: unknown;
      userId: number;
    }> = await trx('stas_outputs as so')
      .join('outputs as o', 'o.outputId', 'so.outputId')
      .select('so.outputId', 'so.tokenId', 'o.lockingScript', 'o.userId');

    const dstasOutputIds: number[] = [];
    const dstasTokenIds = new Set<string>();
    const dstasUsersToOutputs = new Map<number, number[]>();
    for (const row of rows) {
      const hex = toHex(row.lockingScript);
      if (looksLikeClassicStasHex(hex)) continue;
      dstasOutputIds.push(row.outputId);
      if (row.tokenId) dstasTokenIds.add(row.tokenId);
      const list = dstasUsersToOutputs.get(row.userId) ?? [];
      list.push(row.outputId);
      dstasUsersToOutputs.set(row.userId, list);
    }

    if (dstasOutputIds.length > 0) {
      // Stamp protocol = 'dstas' on every identified satellite row.
      await trx('stas_outputs')
        .whereIn('outputId', dstasOutputIds)
        .update({ protocol: 'dstas' });
    }
    if (dstasTokenIds.size > 0) {
      await trx('stas_tokens')
        .whereIn('tokenId', [...dstasTokenIds])
        .update({ protocol: 'dstas' });
    }

    // 3. Move DSTAS outputs into a `dstas-tokens` basket per user. The
    //    wallet-toolbox baskets table is keyed unique on (name, userId),
    //    so per-user provisioning is the safe shape even on databases
    //    that only ever held one user.
    if (dstasUsersToOutputs.size > 0) {
      const now = new Date().toISOString();
      for (const [userId, outputIds] of dstasUsersToOutputs) {
        let basket: { basketId: number } | undefined = await trx('output_baskets')
          .where({ name: DSTAS_BASKET_NAME, userId })
          .first('basketId');
        if (!basket) {
          const [basketId] = await trx('output_baskets').insert({
            userId,
            name: DSTAS_BASKET_NAME,
            // Match the STAS basket's profile: 0 desired UTXOs (no
            // change fragmentation), 10000 sat minimum (the toolbox
            // default — STAS satoshisPerToken is 1 so this is moot).
            numberOfDesiredUTXOs: 0,
            minimumDesiredUTXOValue: 10000,
            isDeleted: 0,
            created_at: now,
            updated_at: now,
          });
          basket = { basketId };
        }
        await trx('outputs')
          .whereIn('outputId', outputIds)
          .update({ basketId: basket.basketId, updated_at: now });
      }
    }
  });
}

/**
 * Down migration is best-effort. SQLite 3.35+ supports `ALTER TABLE
 * DROP COLUMN`; older builds would need a table rebuild. We don't
 * attempt to reverse the basket move — that would require remembering
 * which outputs we relocated, and the forward migration is idempotent
 * enough that running `up()` again is safe.
 */
export async function down(knex: any): Promise<void> {
  await knex.schema.alterTable('stas_outputs', (t: any) => {
    t.dropIndex(['protocol']);
    t.dropColumn('protocol');
  });
  await knex.schema.alterTable('stas_tokens', (t: any) => {
    t.dropColumn('protocol');
  });
}
