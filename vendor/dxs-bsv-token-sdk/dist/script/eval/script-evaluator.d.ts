import { Transaction } from "../../bitcoin/transaction";
import { Bytes } from "../../bytes";
export type PrevOutput = {
    lockingScript: Bytes;
    satoshis: number;
};
export type ScriptEvalContext = {
    tx: Transaction;
    inputIndex: number;
    prevOutputs: PrevOutput[];
};
export type ScriptEvalResult = {
    success: boolean;
    error?: string;
    stack: Bytes[];
    altStack: Bytes[];
    trace?: ScriptTraceStep[];
    equalityTrace?: ScriptEqualityStep[];
};
export type ScriptEvalOptions = {
    allowOpReturn?: boolean;
    scriptFlags?: number;
    trace?: boolean;
    traceLimit?: number;
    strict?: boolean;
    requireDerSignatures?: boolean;
    maxScriptSizeBytes?: number;
    maxOps?: number;
    maxStackDepth?: number;
    maxElementSizeBytes?: number;
};
export type ScriptTraceStep = {
    phase: "unlocking" | "locking";
    pc: number;
    opcode: number;
    stackDepth: number;
    stackTopHex?: string;
    altStackDepth: number;
};
export type ScriptEqualityStep = {
    phase: "unlocking" | "locking";
    pc: number;
    opcode: number;
    leftHex: string;
    rightHex: string;
    result: boolean;
};
export declare const SCRIPT_ENABLE_SIGHASH_FORKID: number;
export declare const SCRIPT_ENABLE_MAGNETIC_OPCODES: number;
export declare const SCRIPT_ENABLE_MONOLITH_OPCODES: number;
export type ResolvePrevOutput = (txId: string, vout: number) => PrevOutput | undefined;
export type TransactionInputEvalResult = {
    inputIndex: number;
    success: boolean;
    error?: string;
};
export type TransactionEvalResult = {
    txId: string;
    success: boolean;
    inputs: TransactionInputEvalResult[];
    errors: string[];
};
export declare const evaluateScripts: (unlockingScript: Bytes, lockingScript: Bytes, ctx: ScriptEvalContext, options?: ScriptEvalOptions) => ScriptEvalResult;
export declare const evaluateTransactionHex: (txHex: string, resolvePrevOutput: ResolvePrevOutput, options?: ScriptEvalOptions) => TransactionEvalResult;
export declare const createPrevOutputResolverFromTransactions: (txMap: Map<string, Transaction>) => ResolvePrevOutput;
//# sourceMappingURL=script-evaluator.d.ts.map