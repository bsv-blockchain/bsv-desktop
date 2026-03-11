/**
 * Optimized query implementations for StorageKnex.
 *
 * The upstream @bsv/wallet-toolbox listCertificates has an N+1 query problem:
 * it issues a separate SELECT on certificate_fields for every certificate.
 * With 2000 certs that's 2001 queries (~275ms). This replacement batches
 * the fields fetch into a single WHERE IN query, reducing it to 2-3 queries (~5ms).
 */

import type { StorageKnex } from '@bsv/wallet-toolbox';

/**
 * Replace the N+1 listCertificates with an O(1) batched version.
 *
 * Original flow (N+1):
 *   1 query:  SELECT * FROM certificates WHERE ...
 *   N queries: SELECT * FROM certificate_fields WHERE certificateId = ?
 *
 * Optimized flow (2-3 queries):
 *   Query 1: SELECT * FROM certificates WHERE ...
 *   Query 2: SELECT * FROM certificate_fields WHERE certificateId IN (...)
 *   Query 3: COUNT(*) (only when page is full)
 */
export function patchListCertificates(storage: StorageKnex): void {
  const knexDb = storage.knex;

  (storage as any).listCertificates = async function (auth: any, vargs: any) {
    const partial: Record<string, any> = {
      userId: auth.userId,
      isDeleted: false,
    };
    if (vargs.partial) {
      const vp = vargs.partial;
      if (vp.type) partial.type = vp.type;
      if (vp.subject) partial.subject = vp.subject;
      if (vp.serialNumber) partial.serialNumber = vp.serialNumber;
      if (vp.certifier) partial.certifier = vp.certifier;
      if (vp.revocationOutpoint) partial.revocationOutpoint = vp.revocationOutpoint;
      if (vp.signature) partial.signature = vp.signature;
    }

    const limit = vargs.limit;
    const offset = vargs.offset || 0;

    function applyCertFilters(query: any) {
      let q = query.where(partial);
      if (vargs.certifiers?.length > 0) q = q.whereIn('certifier', vargs.certifiers);
      if (vargs.types?.length > 0) q = q.whereIn('type', vargs.types);
      return q;
    }

    // Query 1: fetch matching certificates
    const certs = await applyCertFilters(knexDb('certificates'))
      .limit(limit)
      .offset(offset);

    if (certs.length === 0) {
      return { totalCertificates: 0, certificates: [] };
    }

    // Query 2: batch-fetch ALL fields for the found certificates
    const certIds = certs.map((c: any) => c.certificateId);
    const allFields = await knexDb('certificate_fields')
      .whereIn('certificateId', certIds)
      .andWhere('userId', auth.userId);

    // Group fields by certificateId in a single pass
    const fieldsByCertId = new Map<number, any[]>();
    for (const field of allFields) {
      let arr = fieldsByCertId.get(field.certificateId);
      if (!arr) {
        arr = [];
        fieldsByCertId.set(field.certificateId, arr);
      }
      arr.push(field);
    }

    // Build response objects
    const certificates = certs.map((cert: any) => {
      const fields = fieldsByCertId.get(cert.certificateId) || [];
      return {
        type: cert.type,
        subject: cert.subject,
        serialNumber: cert.serialNumber,
        certifier: cert.certifier,
        revocationOutpoint: cert.revocationOutpoint,
        signature: cert.signature,
        fields: Object.fromEntries(fields.map((f: any) => [f.fieldName, f.fieldValue])),
        verifier: cert.verifier,
        keyring: Object.fromEntries(fields.map((f: any) => [f.fieldName, f.masterKey])),
      };
    });

    // Query 3 (conditional): count total only when page is full
    let totalCertificates: number;
    if (certificates.length < limit) {
      totalCertificates = certificates.length;
    } else {
      const [row] = await applyCertFilters(knexDb('certificates')).count('* as count');
      totalCertificates = Number(row.count);
    }

    return { totalCertificates, certificates };
  };
}
