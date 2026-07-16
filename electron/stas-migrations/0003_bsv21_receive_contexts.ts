/**
 * STAS extension schema — migration 0003.
 *
 * Creates `bsv21_receive_contexts`, a per-protocol receive-key ledger that
 * mirrors `stas_receive_contexts`. Each row records a BRC-42-derived owner
 * key (under the BSV-21 protocolID namespace) so a resync can regenerate
 * every receive address from just the persisted high-water mark.
 *
 * No `bsv21_outputs` or `bsv21_tokens` table — BSV-21 token metadata
 * (id, amt, dec, sym, icon) lives on wallet-toolbox basket tags by the
 * 1sat-wallet-toolbox convention, so the satellite stays receive-only.
 */

export async function up(knex: any): Promise<void> {
  if (!(await knex.schema.hasTable('bsv21_receive_contexts'))) {
    await knex.schema.createTable('bsv21_receive_contexts', (t: any) => {
      t.increments('id').primary();
      t.text('profileIdentityKey').notNullable();
      t.integer('keyIndex').notNullable();
      t.text('keyId').notNullable();
      t.text('ownerFieldHash160').notNullable();
      t.text('derivedPublicKey').notNullable();
      t.text('createdAt').notNullable();
      t.unique(['profileIdentityKey', 'keyIndex']);
      t.index(['ownerFieldHash160']);
    });
  }
}

export async function down(knex: any): Promise<void> {
  await knex.schema.dropTableIfExists('bsv21_receive_contexts');
}
