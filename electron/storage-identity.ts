import { PrivateKey } from '@bsv/sdk';
import type { Knex } from 'knex';

export function createLocalStorageIdentityKey(): string {
  return PrivateKey.fromRandom().toPublicKey().toString();
}

/**
 * Legacy BSV Desktop databases used the wallet owner's identity key as the
 * storage provider identity. That identity is shared by every app and device
 * using the wallet, so two unrelated local databases could collide remotely
 * and corrupt the per-provider sync checkpoint namespace.
 *
 * Give each local database its own durable provider identity. Existing wallet
 * data remains in the same database; only the database's sync identity and a
 * local user's active-storage pointer are migrated.
 */
export async function ensureUniqueLocalStorageIdentity(
  db: Knex,
  walletIdentityKey: string,
  generateIdentityKey: () => string = createLocalStorageIdentityKey
): Promise<string> {
  return await db.transaction(async trx => {
    const settings = await trx('settings').select('storageIdentityKey').first();
    if (!settings?.storageIdentityKey) {
      throw new Error('Local wallet storage settings are missing');
    }

    if (settings.storageIdentityKey !== walletIdentityKey) {
      return settings.storageIdentityKey;
    }

    const storageIdentityKey = generateIdentityKey();
    if (!/^(02|03)[0-9a-f]{64}$/i.test(storageIdentityKey) || storageIdentityKey === walletIdentityKey) {
      throw new Error('Could not generate a unique local storage identity');
    }

    await trx('settings')
      .where({ storageIdentityKey: walletIdentityKey })
      .update({ storageIdentityKey, updated_at: new Date() });
    await trx('users')
      .where({ activeStorage: walletIdentityKey })
      .update({ activeStorage: storageIdentityKey, updated_at: new Date() });

    return storageIdentityKey;
  });
}
