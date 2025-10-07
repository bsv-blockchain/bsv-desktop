import { ScriptTemplate, LockingScript, UnlockingScript, Signature, Transaction, TransactionSignature } from '@bsv/sdk'
import { sha256 } from '@bsv/sdk/primitives/Hash'
import { toArray } from '@bsv/sdk/primitives/utils'
import { WalletInterface } from '@bsv/sdk'

function verifyTruthy<T>(v: T | undefined): T {
    if (v == null) throw new Error('must have value')
    return v
}

export default class Importer implements ScriptTemplate {
    lock!: () => LockingScript | Promise<LockingScript>
    unlock(
        client: WalletInterface
    ): {
        sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
        estimateLength: () => Promise<108>
    } {
        return {
            sign: async (tx: Transaction, inputIndex: number) => {
                let signatureScope = TransactionSignature.SIGHASH_FORKID
                signatureScope |= TransactionSignature.SIGHASH_ALL
                const input = tx.inputs[inputIndex]
                const otherInputs = tx.inputs.filter(
                    (_, index) => index !== inputIndex
                )
                const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
                if (sourceTXID == null || sourceTXID === undefined) {
                    throw new Error(
                        'The input sourceTXID or sourceTransaction is required for transaction signing.'
                    )
                }
                if (sourceTXID === '') {
                    throw new Error(
                        'The input sourceTXID or sourceTransaction is required for transaction signing.'
                    )
                }
                const sourceSatoshis =
                    input.sourceTransaction?.outputs[input.sourceOutputIndex].satoshis
                if (sourceSatoshis == null || sourceSatoshis === undefined) {
                    throw new Error(
                        'The sourceSatoshis or input sourceTransaction is required for transaction signing.'
                    )
                }
                const lockingScript =
                    input.sourceTransaction?.outputs[input.sourceOutputIndex]
                        .lockingScript
                if (lockingScript == null) {
                    throw new Error(
                        'The lockingScript or input sourceTransaction is required for transaction signing.'
                    )
                }

                const preimage = TransactionSignature.format({
                    sourceTXID,
                    sourceOutputIndex: verifyTruthy(input.sourceOutputIndex),
                    sourceSatoshis,
                    transactionVersion: tx.version,
                    otherInputs,
                    inputIndex,
                    outputs: tx.outputs,
                    inputSequence: verifyTruthy(input.sequence),
                    subscript: lockingScript,
                    lockTime: tx.lockTime,
                    scope: signatureScope
                })

                const hashToSign = sha256(sha256(preimage))
                const { signature } = await client.createSignature({
                    hashToDirectlySign: hashToSign,
                    protocolID: [1, 'legacy address'],
                    keyID: new Date().toISOString().split('T')[0],
                    counterparty: 'anyone'
                })
                const rawSignature = Signature.fromDER(signature)
                const sig = new TransactionSignature(
                    rawSignature.r,
                    rawSignature.s,
                    signatureScope
                )
                const sigForScript = sig.toChecksigFormat()
                const { publicKey } = await client.getPublicKey({
                    protocolID: [1, 'legacy address'],
                    keyID: new Date().toISOString().split('T')[0],
                    counterparty: 'anyone',
                    forSelf: true
                })
                const pubkeyForScript = toArray(publicKey, 'hex')
                return new UnlockingScript([
                    { op: sigForScript.length, data: sigForScript },
                    { op: pubkeyForScript.length, data: pubkeyForScript }
                ])
            },
            estimateLength: async () => {
                return 108
            }
        }
    }
}
