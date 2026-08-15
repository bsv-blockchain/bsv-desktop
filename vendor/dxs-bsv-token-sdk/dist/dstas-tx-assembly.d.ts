import { TPayment } from "./bitcoin";
import { Bytes } from "./bytes";
import { DstasLockingParams } from "./script/build/dstas-locking-builder";
import { ScriptBuilder } from "./script/build/script-builder";
import { TransactionBuilder } from "./transaction/build/transaction-builder";
export type TDstasAssemblyPayment = TPayment & {
    UnlockingScript?: Bytes;
};
export type TDstasAssemblyDestination = {
    Satoshis: number;
    LockingParams: DstasLockingParams;
};
type TDstasConfigurePhase = "estimate" | "finalize";
export declare const buildDstasLockingScriptBuilder: (params: DstasLockingParams) => ScriptBuilder;
export declare const validateDstasAmounts: (stasPayments: TDstasAssemblyPayment[], destinations: {
    Satoshis: number;
}[]) => void;
export declare const buildSignedDstasTransaction: ({ stasPayments, feePayment, destinations, note, feeRate, omitChangeOutput, isMerge, configureStasInput, }: {
    stasPayments: TDstasAssemblyPayment[];
    feePayment: TPayment;
    destinations: TDstasAssemblyDestination[];
    note?: Bytes[];
    feeRate?: number;
    omitChangeOutput?: boolean;
    isMerge?: boolean;
    configureStasInput?: (args: {
        phase: TDstasConfigurePhase;
        txBuilder: TransactionBuilder;
        inputIndex: number;
        payment: TDstasAssemblyPayment;
        stasInputIndex: number;
        isMerge: boolean;
    }) => void;
}) => string;
export declare const buildSignedDstasIssueTransaction: ({ contractOutPoint, contractChangeOutPoint, contractOwner, destinations, feeRate, }: {
    contractOutPoint: TPayment;
    contractChangeOutPoint: TPayment;
    contractOwner: TPayment["Owner"];
    destinations: TDstasAssemblyDestination[];
    feeRate?: number;
}) => string;
export {};
//# sourceMappingURL=dstas-tx-assembly.d.ts.map