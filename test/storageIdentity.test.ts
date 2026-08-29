import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createLocalStorageIdentityKey, ensureUniqueLocalStorageIdentity } from '../electron/storage-identity';

const walletIdentityKey = `02${'11'.repeat(32)}`;
const localStorageIdentityKey = `03${'22'.repeat(32)}`;

describe('local storage provider identity', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true
    });
    await db.schema.createTable('settings', table => {
      table.string('storageIdentityKey').notNullable();
      table.timestamp('updated_at').notNullable();
    });
    await db.schema.createTable('users', table => {
      table.increments('userId');
      table.string('activeStorage');
      table.timestamp('updated_at').notNullable();
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  test('generates a compressed secp256k1 public key', () => {
    expect(createLocalStorageIdentityKey()).toMatch(/^(02|03)[0-9a-f]{64}$/);
  });

  test('migrates a legacy wallet identity without replacing wallet data', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    await db('settings').insert({ storageIdentityKey: walletIdentityKey, updated_at: createdAt });
    await db('users').insert({ activeStorage: walletIdentityKey, updated_at: createdAt });
    await db('users').insert({ activeStorage: 'remote-storage', updated_at: createdAt });

    const result = await ensureUniqueLocalStorageIdentity(db, walletIdentityKey, () => localStorageIdentityKey);

    expect(result).toBe(localStorageIdentityKey);
    expect((await db('settings').first()).storageIdentityKey).toBe(localStorageIdentityKey);
    expect((await db('users').where({ userId: 1 }).first()).activeStorage).toBe(localStorageIdentityKey);
    expect((await db('users').where({ userId: 2 }).first()).activeStorage).toBe('remote-storage');
  });

  test('keeps an already unique provider identity stable', async () => {
    await db('settings').insert({ storageIdentityKey: localStorageIdentityKey, updated_at: new Date() });
    const generateIdentityKey = vi.fn(() => `02${'33'.repeat(32)}`);

    await expect(
      ensureUniqueLocalStorageIdentity(db, walletIdentityKey, generateIdentityKey)
    ).resolves.toBe(localStorageIdentityKey);
    expect(generateIdentityKey).not.toHaveBeenCalled();
  });
});
