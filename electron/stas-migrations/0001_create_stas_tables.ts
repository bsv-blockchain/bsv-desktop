/**
 * STAS extension schema — migration 0001.
 *
 * Three satellite tables that extend wallet-toolbox's own schema without
 * modifying it. They live in the same SQLite database but are created and
 * tracked by bsv-desktop's own migration set (tracking table
 * `knex_migrations_stas`), so a wallet-toolbox upgrade never touches them.
 *
 *  - stas_tokens            one row per token contract (token-level metadata)
 *  - stas_outputs           one row per STAS UTXO; outputId FKs wallet-toolbox's
 *                           `outputs` table, which stays authoritative for the UTXO
 *  - stas_receive_contexts  every derived BRC-42 receive key, recorded at
 *                           derivation time (before funding); MAX(keyIndex) is the
 *                           receive-key high-water mark used for resync
 *
 * `knex` is typed `any` here: tsconfig.electron has strict:false and this keeps
 * the migration free of a direct knex type dependency.
 */

export async function up(knex: any): Promise<void> {
  if (!(await knex.schema.hasTable('stas_tokens'))) {
    await knex.schema.createTable('stas_tokens', (t: any) => {
      t.text('tokenId').primary();
      t.text('symbol').notNullable();
      t.text('name');
      t.integer('satoshisPerToken').notNullable().defaultTo(1);
      t.boolean('freezeEnabled').notNullable().defaultTo(false);
      t.boolean('confiscationEnabled').notNullable().defaultTo(false);
      t.text('redemptionPkh');
      t.text('issuerIdentityKey');
      t.text('flagsHex');
      t.text('createdAt').notNullable();
    });
  }

  if (!(await knex.schema.hasTable('stas_outputs'))) {
    await knex.schema.createTable('stas_outputs', (t: any) => {
      // outputId is the PK and a FK to wallet-toolbox's `outputs` table —
      // wallet-toolbox owns the UTXO row; this is a satellite extension.
      t.integer('outputId').primary().references('outputId').inTable('outputs');
      t.text('tokenId').notNullable().references('tokenId').inTable('stas_tokens');
      t.text('brc42KeyId');
      t.text('ownerFieldHash160').notNullable();
      t.bigInteger('tokenSatoshis').notNullable();
      t.boolean('frozen').notNullable().defaultTo(false);
      t.boolean('confiscated').notNullable().defaultTo(false);
      t.text('serviceFieldsJson');
      t.text('createdAt').notNullable();
      t.text('updatedAt').notNullable();
      t.index(['tokenId']);
      t.index(['ownerFieldHash160']);
    });
  }

  if (!(await knex.schema.hasTable('stas_receive_contexts'))) {
    await knex.schema.createTable('stas_receive_contexts', (t: any) => {
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
  await knex.schema.dropTableIfExists('stas_outputs');
  await knex.schema.dropTableIfExists('stas_receive_contexts');
  await knex.schema.dropTableIfExists('stas_tokens');
}
