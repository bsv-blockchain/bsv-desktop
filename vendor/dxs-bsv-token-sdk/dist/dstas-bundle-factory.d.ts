import { Address, OutPoint, Transaction, Wallet } from "./bitcoin";
import { Bytes } from "./bytes";
import { TransactionBuilder } from "./transaction";
import { DstasLockingParams } from "./script/build/dstas-locking-builder";
import { TDstasAssemblyPayment } from "./dstas-tx-assembly";
export declare const AvgFeeForDstasMerge = 500;
export type TDstasFundingUtxoRequest = {
    utxoIdsToSpend: string[];
    estimatedFeeSatoshis: number;
    transactionsCount: number;
};
export type TDstasGetUtxoFunction = (satoshis?: number) => Promise<OutPoint[]>;
export type TDstasGetFundingUtxoFunction = (request: TDstasFundingUtxoRequest) => Promise<OutPoint>;
export type TDstasGetTransactionsFunction = (ids: string[]) => Promise<Record<string, Transaction>>;
export type TDstasPayoutBundle = {
    transactions?: string[];
    feeSatoshis: number;
    message?: string;
    devMessage?: string;
};
export type DstasSpendType = "transfer" | "split" | "merge" | "freeze" | "unfreeze" | "confiscation" | "swap";
export type TDstasRecipient = {
    m: number;
    addresses: Address[];
};
export type TDstasTransferOutput = {
    recipient: TDstasRecipient;
    satoshis: number;
};
export type TDstasTransferRequest = {
    outputs: TDstasTransferOutput[];
    spendType?: "transfer" | "freeze" | "unfreeze";
    note?: Bytes[];
};
export type TDstasLockingParamsBuilder = (args: {
    fromOutPoint: OutPoint;
    recipient: TDstasRecipient;
    spendType: DstasSpendType;
    isFreezeLike: boolean;
    outputIndex: number;
    outputCount: number;
    isChange: boolean;
}) => DstasLockingParams;
export type TDstasUnlockingScriptBuilder = {
    (args: {
        txBuilder: TransactionBuilder;
        inputIndex: number;
        outPoint: OutPoint;
        spendType: DstasSpendType;
        isFreezeLike: boolean;
        isMerge: boolean;
    }): Bytes;
    estimateSize?: TDstasUnlockingScriptEstimator;
};
export type TDstasUnlockingScriptEstimator = (args: Parameters<TDstasUnlockingScriptBuilder>[0]) => number;
export type TDstasPayment = TDstasAssemblyPayment;
export type TDstasDestination = {
    Satoshis: number;
    LockingParams: DstasLockingParams;
};
export declare class DstasBundleFactory {
    private readonly stasWallet;
    private readonly feeWallet;
    private readonly getFundingUtxo;
    private readonly getStasUtxoSet;
    private readonly getTransactions;
    private readonly buildLockingParams;
    private readonly buildUnlockingScript;
    constructor(stasWallet: Wallet, feeWallet: Wallet, getFundingUtxo: TDstasGetFundingUtxoFunction, getStasUtxoSet: TDstasGetUtxoFunction, getTransactions: TDstasGetTransactionsFunction, buildLockingParams: TDstasLockingParamsBuilder, buildUnlockingScript: TDstasUnlockingScriptBuilder);
    transfer: ({ outputs, spendType, note, }: TDstasTransferRequest) => Promise<TDstasPayoutBundle>;
    createTransferBundle: (amountSatoshis: number, recipient: TDstasRecipient, note?: Bytes[]) => Promise<TDstasPayoutBundle>;
    createFreezeBundle: (amountSatoshis: number, recipient: TDstasRecipient, note?: Bytes[]) => Promise<TDstasPayoutBundle>;
    createUnfreezeBundle: (amountSatoshis: number, recipient: TDstasRecipient, note?: Bytes[]) => Promise<TDstasPayoutBundle>;
    createSwapBundle: (amountSatoshis: number, recipient: TDstasRecipient, note?: Bytes[]) => Promise<TDstasPayoutBundle>;
    createConfiscationBundle: (amountSatoshis: number, recipient: TDstasRecipient, note?: Bytes[]) => Promise<TDstasPayoutBundle>;
    createBundle: (amountSatoshis: number, recipient: TDstasRecipient, spendType: DstasSpendType, note?: Bytes[]) => Promise<TDstasPayoutBundle>;
    private buildBundleWithResolvedFunding;
    private estimateTransactionsCount;
    private estimateMergeTransactionsCount;
    private estimateFinalTransferTransactionsCount;
    private estimateBundleFeeUpperBound;
    private isInsufficientFeeError;
    private _createTransferBundle;
    private buildTransferPlanTransactions;
    private getStasUtxo;
    private mergeStasTransactions;
    private buildDstasTx;
    private buildDestinations;
    private outPointFromTransaction;
    private getStasOutPoint;
    private getFeeOutPoint;
}
//# sourceMappingURL=dstas-bundle-factory.d.ts.map