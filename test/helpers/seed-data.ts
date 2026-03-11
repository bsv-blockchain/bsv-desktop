/**
 * Generates deterministic test data for seeding the storage layer.
 *
 * Uses index-based values for reproducibility.
 */

import type { StorageKnex } from '@bsv/wallet-toolbox'

/** Generate a deterministic 64-char hex string from an index */
function hexFromIndex(index: number, prefix = ''): string {
  const base = prefix + index.toString(16).padStart(8, '0')
  return base.padEnd(64, 'a')
}

/** Generate a deterministic 66-char pubkey hex from an index */
function pubkeyFromIndex(index: number): string {
  return '02' + hexFromIndex(index)
}

/** Generate a deterministic base64 string from an index */
function base64FromIndex(index: number): string {
  return Buffer.from(`type-${index.toString().padStart(8, '0')}`).toString('base64')
}

/**
 * Seed certificates with realistic fields.
 * Inserts directly via knex for speed (bypasses StorageKnex validation overhead).
 */
export async function seedCertificates(
  storage: StorageKnex,
  userId: number,
  count: number
): Promise<void> {
  const knex = storage.knex
  const now = new Date().toISOString()

  // Use batches of 500 for large inserts
  const batchSize = 500
  for (let batchStart = 0; batchStart < count; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, count)
    const rows = []
    for (let i = batchStart; i < batchEnd; i++) {
      rows.push({
        created_at: now,
        updated_at: now,
        userId,
        type: base64FromIndex(i % 10), // 10 distinct types
        serialNumber: base64FromIndex(i),
        certifier: pubkeyFromIndex(i % 5), // 5 distinct certifiers
        subject: pubkeyFromIndex(100 + i),
        revocationOutpoint: hexFromIndex(i) + '.0',
        signature: hexFromIndex(i, 'sig'),
        isDeleted: 0,
      })
    }
    await knex('certificates').insert(rows)

    // Also insert some certificate fields for each cert
    // Get the inserted certificate IDs for this batch
    const insertedCerts = await knex('certificates')
      .select('certificateId')
      .orderBy('certificateId', 'asc')
      .offset(batchStart)
      .limit(batchEnd - batchStart)

    const fieldRows = []
    for (let j = 0; j < insertedCerts.length; j++) {
      const certId = insertedCerts[j].certificateId
      // 3 fields per certificate
      for (let f = 0; f < 3; f++) {
        fieldRows.push({
          created_at: now,
          updated_at: now,
          userId,
          certificateId: certId,
          fieldName: `field_${f}`,
          fieldValue: `encrypted-value-${batchStart + j}-${f}`,
          masterKey: `masterkey-${batchStart + j}-${f}`,
        })
      }
    }
    if (fieldRows.length > 0) {
      // Insert fields in sub-batches too
      for (let fs = 0; fs < fieldRows.length; fs += batchSize) {
        await knex('certificate_fields').insert(
          fieldRows.slice(fs, fs + batchSize)
        )
      }
    }
  }
}

/**
 * Seed output baskets. Returns the created basket IDs.
 */
export async function seedBaskets(
  storage: StorageKnex,
  userId: number,
  names: string[]
): Promise<number[]> {
  const knex = storage.knex
  const now = new Date().toISOString()
  const ids: number[] = []

  for (const name of names) {
    // Check if basket already exists (e.g. "default" is created by makeAvailable)
    const existing = await knex('output_baskets')
      .where({ userId, name })
      .first()
    if (existing) {
      ids.push(existing.basketId)
    } else {
      const [id] = await knex('output_baskets').insert({
        created_at: now,
        updated_at: now,
        userId,
        name,
        numberOfDesiredUTXOs: 10,
        minimumDesiredUTXOValue: 1000,
        isDeleted: 0,
      })
      ids.push(id)
    }
  }
  return ids
}

/**
 * Seed transactions. Returns the created transaction IDs.
 */
export async function seedTransactions(
  storage: StorageKnex,
  userId: number,
  count: number
): Promise<number[]> {
  const knex = storage.knex
  const now = new Date().toISOString()
  const ids: number[] = []

  const batchSize = 500
  for (let batchStart = 0; batchStart < count; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, count)
    const rows = []
    for (let i = batchStart; i < batchEnd; i++) {
      rows.push({
        created_at: now,
        updated_at: now,
        userId,
        status: 'completed',
        reference: base64FromIndex(i),
        isOutgoing: i % 2 === 0 ? 1 : 0,
        satoshis: 1000 + i,
        description: `Test transaction ${i}`,
        txid: hexFromIndex(i, 'tx'),
        version: 1,
        lockTime: 0,
      })
    }
    const result = await knex('transactions').insert(rows)
    // Collect IDs - SQLite returns last insert ID for batch
    const lastId = result[0]
    const batchCount = batchEnd - batchStart
    for (let j = 0; j < batchCount; j++) {
      ids.push(lastId - batchCount + 1 + j)
    }
  }
  return ids
}

/**
 * Seed transaction labels and label maps.
 */
export async function seedTxLabels(
  storage: StorageKnex,
  userId: number,
  transactionIds: number[],
  labels: string[]
): Promise<void> {
  const knex = storage.knex
  const now = new Date().toISOString()

  // Insert labels
  const labelIds: number[] = []
  for (const label of labels) {
    const [id] = await knex('tx_labels').insert({
      created_at: now,
      updated_at: now,
      userId,
      label,
      isDeleted: 0,
    })
    labelIds.push(id)
  }

  // Map each transaction to one or two labels
  const mapRows = []
  for (let i = 0; i < transactionIds.length; i++) {
    mapRows.push({
      created_at: now,
      updated_at: now,
      transactionId: transactionIds[i],
      txLabelId: labelIds[i % labelIds.length],
      isDeleted: 0,
    })
  }

  const batchSize = 500
  for (let bs = 0; bs < mapRows.length; bs += batchSize) {
    await knex('tx_labels_map').insert(mapRows.slice(bs, bs + batchSize))
  }
}

/**
 * Seed outputs with baskets, lockingScript, satoshis, transactionId.
 */
export async function seedOutputs(
  storage: StorageKnex,
  userId: number,
  count: number,
  basketIds: number[],
  transactionIds: number[]
): Promise<void> {
  const knex = storage.knex
  const now = new Date().toISOString()

  // A small dummy locking script (P2PKH-ish)
  const dummyScript = Array.from({ length: 25 }, (_, i) => i)

  const batchSize = 500
  for (let batchStart = 0; batchStart < count; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, count)
    const rows = []
    for (let i = batchStart; i < batchEnd; i++) {
      rows.push({
        created_at: now,
        updated_at: now,
        userId,
        transactionId: transactionIds[i % transactionIds.length],
        basketId: basketIds[i % basketIds.length],
        spendable: 1,
        change: i % 3 === 0 ? 1 : 0,
        outputDescription: 'test output',
        vout: i % 4,
        satoshis: 1000 + i * 10,
        providedBy: 'you',
        purpose: 'change',
        type: 'P2PKH',
        txid: hexFromIndex(i, 'tx'),
        lockingScript: JSON.stringify(dummyScript),
        scriptLength: 25,
        scriptOffset: 0,
      })
    }
    await knex('outputs').insert(rows)
  }
}
