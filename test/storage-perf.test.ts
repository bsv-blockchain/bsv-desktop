/**
 * Storage Performance Baseline Tests
 *
 * Measures the full application path in-process:
 *   StorageElectronIPC-style proxy (JSON serialization)
 *     -> simulated IPC dispatch
 *     -> StorageKnex
 *     -> SQLite
 *     -> JSON serialization of results back
 *
 * This captures all overhead except the actual Electron IPC transport (~0.1ms/call).
 */

import { describe, test, beforeAll, afterAll, expect } from 'vitest'
import { createTestDb, type TestDb } from './helpers/create-test-db'
import {
  seedCertificates,
  seedBaskets,
  seedTransactions,
  seedTxLabels,
  seedOutputs,
} from './helpers/seed-data'
import { IPCSimulator } from './helpers/ipc-simulator'

// ── Measurement utility ──────────────────────────────────────────────

interface MeasureResult {
  min: number
  avg: number
  max: number
  p95: number
  times: number[]
}

async function measure(
  label: string,
  fn: () => Promise<any>,
  iterations = 10
): Promise<MeasureResult> {
  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fn()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const min = times[0]
  const max = times[times.length - 1]
  const avg = times.reduce((a, b) => a + b) / times.length
  const p95 = times[Math.floor(times.length * 0.95)]
  console.log(
    `  ${label.padEnd(45)} min=${min.toFixed(2).padStart(8)}ms  avg=${avg.toFixed(2).padStart(8)}ms  max=${max.toFixed(2).padStart(8)}ms  p95=${p95.toFixed(2).padStart(8)}ms`
  )
  return { min, avg, max, p95, times }
}

// ── Test suites at different data scales ────────────────────────────

describe('Storage Performance Baseline', () => {
  // We test at three scales: 100, 500, 2000
  // Each scale gets its own DB to keep tests independent.

  describe('Scale: 100 records', () => {
    let testDb: TestDb
    let ipc: IPCSimulator

    beforeAll(async () => {
      testDb = await createTestDb()
      ipc = new IPCSimulator(testDb.storage)

      const basketIds = await seedBaskets(testDb.storage, testDb.userId, [
        'default',
        'tokens',
        'nfts',
      ])
      const txIds = await seedTransactions(
        testDb.storage,
        testDb.userId,
        100
      )
      await seedTxLabels(testDb.storage, testDb.userId, txIds, [
        'bsvdesktop',
        'inbound',
        'outbound',
      ])
      await seedCertificates(testDb.storage, testDb.userId, 100)
      await seedOutputs(testDb.storage, testDb.userId, 100, basketIds, txIds)
    }, 60_000)

    afterAll(async () => {
      await testDb.cleanup()
    })

    describe('listCertificates (focus: known slow)', () => {
      test('100 certs, no filters', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const result = await measure('listCertificates(100, no filter)', () =>
          ipc.callMethod('listCertificates', [
            auth,
            {
              certifiers: [],
              types: [],
              limit: 100,
              offset: 0,
              privileged: false,
            },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })

      test('100 certs, filter by type', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const type0 = Buffer.from('type-00000000').toString('base64')
        const result = await measure(
          'listCertificates(100, filter type)',
          () =>
            ipc.callMethod('listCertificates', [
              auth,
              {
                certifiers: [],
                types: [type0],
                limit: 100,
                offset: 0,
                privileged: false,
              },
            ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })

      test('100 certs, filter by certifier', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const certifier0 =
          '02' + ('0' + (0).toString(16)).slice(-2).padStart(8, '0').padEnd(64, 'a')
        const result = await measure(
          'listCertificates(100, filter certifier)',
          () =>
            ipc.callMethod('listCertificates', [
              auth,
              {
                certifiers: [certifier0],
                types: [],
                limit: 100,
                offset: 0,
                privileged: false,
              },
            ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('findCertificates', () => {
      test('find all (no filter)', async () => {
        const result = await measure('findCertificates(100, no filter)', () =>
          ipc.callMethod('findCertificates', [
            { partial: { userId: testDb.userId } },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })

      test('find by certifier', async () => {
        const certifier0 =
          '02' + (0).toString(16).padStart(8, '0').padEnd(64, 'a')
        const result = await measure(
          'findCertificates(100, by certifier)',
          () =>
            ipc.callMethod('findCertificates', [
              { partial: { userId: testDb.userId, certifier: certifier0 } },
            ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('findOutputs', () => {
      test('100 outputs, no filter', async () => {
        const result = await measure('findOutputs(100, no filter)', () =>
          ipc.callMethod('findOutputs', [
            { partial: { userId: testDb.userId }, noScript: true },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('listOutputs', () => {
      test('list with limit 10', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const result = await measure('listOutputs(100, limit 10)', () =>
          ipc.callMethod('listOutputs', [
            auth,
            {
              basket: 'default',
              tags: [],
              tagQueryMode: 'all',
              includeLockingScripts: false,
              includeTransactions: false,
              includeCustomInstructions: false,
              includeTags: false,
              includeLabels: false,
              limit: 10,
              offset: 0,
              seekPermission: false,
              knownTxids: [],
            },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })

      test('list all', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const result = await measure('listOutputs(100, all)', () =>
          ipc.callMethod('listOutputs', [
            auth,
            {
              basket: 'default',
              tags: [],
              tagQueryMode: 'all',
              includeLockingScripts: false,
              includeTransactions: false,
              includeCustomInstructions: false,
              includeTags: false,
              includeLabels: false,
              limit: 10000,
              offset: 0,
              seekPermission: false,
              knownTxids: [],
            },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('listActions', () => {
      test('100 transactions', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const result = await measure('listActions(100)', () =>
          ipc.callMethod('listActions', [
            auth,
            {
              labels: ['bsvdesktop'],
              labelQueryMode: 'any',
              includeLabels: false,
              includeInputs: false,
              includeInputSourceLockingScripts: false,
              includeInputUnlockingScripts: false,
              includeOutputs: false,
              includeOutputLockingScripts: false,
              limit: 100,
              offset: 0,
              seekPermission: false,
            },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('findTransactions', () => {
      test('find all', async () => {
        const result = await measure('findTransactions(100)', () =>
          ipc.callMethod('findTransactions', [
            { partial: { userId: testDb.userId }, noRawTx: true },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('write operations', () => {
      test('insertCertificate (single)', async () => {
        let counter = 10000
        const result = await measure('insertCertificate(single)', async () => {
          counter++
          const now = new Date()
          await ipc.callMethod('insertCertificate', [
            {
              created_at: now,
              updated_at: now,
              userId: testDb.userId,
              type: Buffer.from(`perf-type-${counter}`).toString('base64'),
              serialNumber: Buffer.from(`perf-sn-${counter}`).toString(
                'base64'
              ),
              certifier:
                '02' + counter.toString(16).padStart(8, '0').padEnd(64, 'b'),
              subject:
                '02' + counter.toString(16).padStart(8, '0').padEnd(64, 'c'),
              revocationOutpoint:
                counter.toString(16).padEnd(64, 'd') + '.0',
              signature: counter.toString(16).padEnd(64, 'e'),
              isDeleted: false,
            },
          ])
        })
        expect(result.avg).toBeGreaterThan(0)
      })

      test('insertOutput (single)', async () => {
        let counter = 10000
        // Use existing basket from seeded data
        const existingBasket = await testDb.db('output_baskets').first()
        const basketId = existingBasket.basketId
        const result = await measure('insertOutput(single)', async () => {
          counter++
          const now = new Date()
          // Create a unique transaction per output to avoid vout constraint
          const [txId] = await testDb.db('transactions').insert({
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
            userId: testDb.userId,
            status: 'completed',
            reference: Buffer.from(`out-perf-${counter}`).toString('base64'),
            isOutgoing: 1,
            satoshis: 5000 + counter,
            description: `perf output tx ${counter}`,
            version: 1,
            lockTime: 0,
          })
          await ipc.callMethod('insertOutput', [
            {
              created_at: now,
              updated_at: now,
              userId: testDb.userId,
              transactionId: txId,
              basketId,
              spendable: true,
              change: false,
              outputDescription: 'perf test',
              vout: 0,
              satoshis: 5000 + counter,
              providedBy: 'you',
              purpose: 'change',
              type: 'P2PKH',
              txid: counter.toString(16).padEnd(64, 'f'),
              lockingScript: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
              scriptLength: 10,
              scriptOffset: 0,
            },
          ])
        })
        expect(result.avg).toBeGreaterThan(0)
      })
    })
  })

  describe('Scale: 500 records', () => {
    let testDb: TestDb
    let ipc: IPCSimulator

    beforeAll(async () => {
      testDb = await createTestDb()
      ipc = new IPCSimulator(testDb.storage)

      const basketIds = await seedBaskets(testDb.storage, testDb.userId, [
        'default',
        'tokens',
        'nfts',
      ])
      const txIds = await seedTransactions(
        testDb.storage,
        testDb.userId,
        500
      )
      await seedTxLabels(testDb.storage, testDb.userId, txIds, [
        'bsvdesktop',
        'inbound',
        'outbound',
      ])
      await seedCertificates(testDb.storage, testDb.userId, 500)
      await seedOutputs(testDb.storage, testDb.userId, 500, basketIds, txIds)
    }, 60_000)

    afterAll(async () => {
      await testDb.cleanup()
    })

    describe('listCertificates', () => {
      test('500 certs, no filters', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const result = await measure('listCertificates(500, no filter)', () =>
          ipc.callMethod('listCertificates', [
            auth,
            {
              certifiers: [],
              types: [],
              limit: 500,
              offset: 0,
              privileged: false,
            },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('findCertificates', () => {
      test('find all', async () => {
        const result = await measure('findCertificates(500)', () =>
          ipc.callMethod('findCertificates', [
            { partial: { userId: testDb.userId } },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('findOutputs', () => {
      test('500 outputs, no filter', async () => {
        const result = await measure('findOutputs(500, no filter)', () =>
          ipc.callMethod('findOutputs', [
            { partial: { userId: testDb.userId }, noScript: true },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })

      test('500 outputs, by basket', async () => {
        const result = await measure('findOutputs(500, by basket)', () =>
          ipc.callMethod('findOutputs', [
            { partial: { userId: testDb.userId, basketId: 1 }, noScript: true },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('listOutputs', () => {
      test('list all', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const result = await measure('listOutputs(500, all)', () =>
          ipc.callMethod('listOutputs', [
            auth,
            {
              basket: 'default',
              tags: [],
              tagQueryMode: 'all',
              includeLockingScripts: false,
              includeTransactions: false,
              includeCustomInstructions: false,
              includeTags: false,
              includeLabels: false,
              limit: 10000,
              offset: 0,
              seekPermission: false,
              knownTxids: [],
            },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('listActions', () => {
      test('500 transactions', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const result = await measure('listActions(500)', () =>
          ipc.callMethod('listActions', [
            auth,
            {
              labels: ['bsvdesktop'],
              labelQueryMode: 'any',
              includeLabels: false,
              includeInputs: false,
              includeInputSourceLockingScripts: false,
              includeInputUnlockingScripts: false,
              includeOutputs: false,
              includeOutputLockingScripts: false,
              limit: 500,
              offset: 0,
              seekPermission: false,
            },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('write operations', () => {
      test('100 sequential insertCertificate', async () => {
        let counter = 50000
        const result = await measure(
          '100x insertCertificate (sequential)',
          async () => {
            const now = new Date()
            for (let i = 0; i < 100; i++) {
              counter++
              await ipc.callMethod('insertCertificate', [
                {
                  created_at: now,
                  updated_at: now,
                  userId: testDb.userId,
                  type: Buffer.from(`batch-type-${counter}`).toString(
                    'base64'
                  ),
                  serialNumber: Buffer.from(`batch-sn-${counter}`).toString(
                    'base64'
                  ),
                  certifier:
                    '02' +
                    counter.toString(16).padStart(8, '0').padEnd(64, 'b'),
                  subject:
                    '02' +
                    counter.toString(16).padStart(8, '0').padEnd(64, 'c'),
                  revocationOutpoint:
                    counter.toString(16).padEnd(64, 'd') + '.0',
                  signature: counter.toString(16).padEnd(64, 'e'),
                  isDeleted: false,
                },
              ])
            }
          },
          3 // fewer iterations for batch writes
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })
  })

  describe('Scale: 2000 records', () => {
    let testDb: TestDb
    let ipc: IPCSimulator

    beforeAll(async () => {
      testDb = await createTestDb()
      ipc = new IPCSimulator(testDb.storage)

      const basketIds = await seedBaskets(testDb.storage, testDb.userId, [
        'default',
        'tokens',
        'nfts',
        'collectibles',
      ])
      const txIds = await seedTransactions(
        testDb.storage,
        testDb.userId,
        2000
      )
      await seedTxLabels(testDb.storage, testDb.userId, txIds, [
        'bsvdesktop',
        'inbound',
        'outbound',
        'transfer',
      ])
      await seedCertificates(testDb.storage, testDb.userId, 2000)
      await seedOutputs(testDb.storage, testDb.userId, 2000, basketIds, txIds)
    }, 90_000)

    afterAll(async () => {
      await testDb.cleanup()
    })

    describe('listCertificates', () => {
      test('2000 certs, no filters', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const result = await measure(
          'listCertificates(2000, no filter)',
          () =>
            ipc.callMethod('listCertificates', [
              auth,
              {
                certifiers: [],
                types: [],
                limit: 2000,
                offset: 0,
                privileged: false,
              },
            ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })

      test('2000 certs, filter by type', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const type0 = Buffer.from('type-00000000').toString('base64')
        const result = await measure(
          'listCertificates(2000, filter type)',
          () =>
            ipc.callMethod('listCertificates', [
              auth,
              {
                certifiers: [],
                types: [type0],
                limit: 2000,
                offset: 0,
                privileged: false,
              },
            ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })

      test('2000 certs, filter by certifier', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const certifier0 =
          '02' + (0).toString(16).padStart(8, '0').padEnd(64, 'a')
        const result = await measure(
          'listCertificates(2000, filter certifier)',
          () =>
            ipc.callMethod('listCertificates', [
              auth,
              {
                certifiers: [certifier0],
                types: [],
                limit: 2000,
                offset: 0,
                privileged: false,
              },
            ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('findCertificates', () => {
      test('find all', async () => {
        const result = await measure('findCertificates(2000)', () =>
          ipc.callMethod('findCertificates', [
            { partial: { userId: testDb.userId } },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })

      test('find by type', async () => {
        const type0 = Buffer.from('type-00000000').toString('base64')
        const result = await measure(
          'findCertificates(2000, by type)',
          () =>
            ipc.callMethod('findCertificates', [
              {
                partial: { userId: testDb.userId },
                types: [type0],
              },
            ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('findOutputs', () => {
      test('2000 outputs, no filter', async () => {
        const result = await measure('findOutputs(2000, no filter)', () =>
          ipc.callMethod('findOutputs', [
            { partial: { userId: testDb.userId }, noScript: true },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })

      test('2000 outputs, by basket', async () => {
        const result = await measure('findOutputs(2000, by basket)', () =>
          ipc.callMethod('findOutputs', [
            { partial: { userId: testDb.userId, basketId: 1 }, noScript: true },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('listOutputs', () => {
      test('list with limit 10', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const result = await measure('listOutputs(2000, limit 10)', () =>
          ipc.callMethod('listOutputs', [
            auth,
            {
              basket: 'default',
              tags: [],
              tagQueryMode: 'all',
              includeLockingScripts: false,
              includeTransactions: false,
              includeCustomInstructions: false,
              includeTags: false,
              includeLabels: false,
              limit: 10,
              offset: 0,
              seekPermission: false,
              knownTxids: [],
            },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })

      test('list all', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const result = await measure('listOutputs(2000, all)', () =>
          ipc.callMethod('listOutputs', [
            auth,
            {
              basket: 'default',
              tags: [],
              tagQueryMode: 'all',
              includeLockingScripts: false,
              includeTransactions: false,
              includeCustomInstructions: false,
              includeTags: false,
              includeLabels: false,
              limit: 10000,
              offset: 0,
              seekPermission: false,
              knownTxids: [],
            },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('listActions', () => {
      test('2000 transactions', async () => {
        const auth = { identityKey: testDb.identityKey, userId: testDb.userId }
        const result = await measure('listActions(2000)', () =>
          ipc.callMethod('listActions', [
            auth,
            {
              labels: ['bsvdesktop'],
              labelQueryMode: 'any',
              includeLabels: false,
              includeInputs: false,
              includeInputSourceLockingScripts: false,
              includeInputUnlockingScripts: false,
              includeOutputs: false,
              includeOutputLockingScripts: false,
              limit: 2000,
              offset: 0,
              seekPermission: false,
            },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })

    describe('findTransactions', () => {
      test('find all', async () => {
        const result = await measure('findTransactions(2000)', () =>
          ipc.callMethod('findTransactions', [
            { partial: { userId: testDb.userId }, noRawTx: true },
          ])
        )
        expect(result.avg).toBeGreaterThan(0)
      })
    })
  })
})
