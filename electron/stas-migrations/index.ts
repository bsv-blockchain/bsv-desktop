/**
 * STAS migration source.
 *
 * A Knex `MigrationSource` whose migrations are plain ES modules in this
 * directory (compiled by tsconfig.electron to dist-electron/stas-migrations/).
 * Because the migrations are imported statically — not discovered from disk by
 * Knex's file scanner — no `.cjs` files and no build-time copy step are needed.
 *
 * Wired into electron/storage.ts as a SECOND `db.migrate.latest()` pass that
 * runs after wallet-toolbox's own migrations, with a separate tracking table
 * (`knex_migrations_stas`) so the two ledgers never collide.
 */

import * as m0001 from './0001_create_stas_tables.js';
import * as m0002 from './0002_add_protocol_column.js';
import * as m0003 from './0003_bsv21_receive_contexts.js';
import * as m0004 from './0004_token_verifications.js';

type StasMigration = {
  name: string;
  up: (knex: any) => Promise<void>;
  down: (knex: any) => Promise<void>;
};

const migrations: StasMigration[] = [
  { name: '0001_create_stas_tables', up: m0001.up, down: m0001.down },
  { name: '0002_add_protocol_column', up: m0002.up, down: m0002.down },
  { name: '0003_bsv21_receive_contexts', up: m0003.up, down: m0003.down },
  { name: '0004_token_verifications', up: m0004.up, down: m0004.down },
];

/** Knex MigrationSource over the statically-imported STAS migrations. */
export const stasMigrationSource = {
  async getMigrations(): Promise<StasMigration[]> {
    return migrations;
  },
  getMigrationName(migration: StasMigration): string {
    return migration.name;
  },
  async getMigration(migration: StasMigration): Promise<{
    up: (knex: any) => Promise<void>;
    down: (knex: any) => Promise<void>;
  }> {
    return { up: migration.up, down: migration.down };
  },
};
