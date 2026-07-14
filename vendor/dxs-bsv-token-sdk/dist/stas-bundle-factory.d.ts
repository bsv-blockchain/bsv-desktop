import { Address, OutPoint, TokenScheme, Transaction, Wallet } from "./bitcoin";
import { Bytes } from "./bytes";
export declare const AvgFeeForMerge = 500;
export type TFundingUtxoRequest = {
    utxoIdsToSpend: string[];
    estimatedFeeSatoshis: number;
    transactionsCount: number;
};
export type TGetUtxoFunction = (satoshis?: number) => Promise<OutPoint[]>;
export type TGetFundingUtxoFunction = (request: TFundingUtxoRequest) => Promise<OutPoint>;
export type TGetTransactionsFunction = (ids: string[]) => Promise<Record<string, Transaction>>;
export type TStasPayoutBundle = {
    transactions?: string[];
    feeSatoshis: number;
    message?: string;
    devMessage?: string;
};
export declare class StasBundleFactory {
    private readonly tokenScheme;
    private readonly stasWallet;
    private readonly feeWallet;
    private readonly getFundingUtxo;
    private readonly getStasUtxoSet;
    private readonly getTransactions;
    constructor(tokenScheme: TokenScheme, stasWallet: Wallet, feeWallet: Wallet, getFundingUtxo: TGetFundingUtxoFunction, getStasUtxoSet: TGetUtxoFunction, getTransactions: TGetTransactionsFunction);
    createBundle: (amountSatoshis: number, to: Address, note?: Bytes[]) => Promise<TStasPayoutBundle>;
    private buildFeeProbeOutPoint;
    private _createBundle;
    private getStasUtxo;
    private buildFeeTransaction;
    private mergeStasTransactions;
    private buildTransferTransaction;
    private buildSplitTransaction;
}
//# sourceMappingURL=stas-bundle-factory.d.ts.map