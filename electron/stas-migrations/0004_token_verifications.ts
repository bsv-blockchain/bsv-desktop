/**
 * STAS extension schema — migration 0004.
 *
 * Creates `token_verifications`, a per-outpoint Back-to-Genesis provenance
 * cache. One row per token UTXO the wallet has verified, keyed on the outpoint
 * `(txid, vout)`. It is deliberately standard-agnostic — STAS, DSTAS and BSV-21
 * all share it — because BSV-21 has no satellite holdings table, and an
 * outpoint's provenance is the same question regardless of token standard.
 *
 * Durability is the whole point: a verdict for a fixed outpoint is immutable
 * (a reorg aside), so persisting it here means a re-opened wallet — or a fresh
 * install restoring the same DB — shows Verified / Counterfeit badges instantly
 * without re-walking the chain. The renderer's in-memory cache is only a
 * same-session accelerator on top of this.
 *
 * Only SETTLED verdicts (`authentic` / `not-authentic`) are stored;
 * `undetermined` means "couldn't decide yet" and must be retried, never frozen.
 * `genesis` is the resolved `<txid>_<vout>` — the sole spoof-proof token
 * identity for classic STAS (whose tokenId is merely the issuer PKH).
 */

export async function up(knex: any): Promise<void> {
  if (!(await knex.schema.hasTable('token_verifications'))) {
    await knex.schema.createTable('token_verifications', (t: any) => {
      t.text('txid').notNullable();
      t.integer('vout').notNullable();
      t.text('protocol').notNullable(); // 'stas' | 'dstas' | 'bsv-21'
      t.text('result').notNullable(); // 'authentic' | 'not-authentic'
      t.text('genesis'); // '<txid>_<vout>' of the resolved genesis; null if none
      t.integer('genesisDepth');
      t.text('reason'); // set when not-authentic
      t.text('verifiedAt').notNullable();
      t.primary(['txid', 'vout']);
      t.index(['genesis']);
    });
  }
}

export async function down(knex: any): Promise<void> {
  await knex.schema.dropTableIfExists('token_verifications');
}
