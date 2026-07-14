import { Address, OutPointFull, PrivateKey, TDestination, TokenScheme, TPayment, Wallet } from "./bitcoin";
import { Bytes } from "./bytes";
export declare const FeeRate = 0.1;
export type TBuildTransferTxRequest = {
    tokenScheme: TokenScheme;
    stasPayment: TPayment;
    feePayment: TPayment;
    to: Address;
    note?: Bytes[];
    feeRate: number;
};
export declare const BuildTransferTx: ({ tokenScheme, stasPayment, feePayment, to, note, feeRate, }: TBuildTransferTxRequest) => string;
export type TBuildSplitTxRequest = {
    tokenScheme: TokenScheme;
    stasPayment: TPayment;
    feePayment: TPayment;
    destinations: TDestination[];
    note?: Bytes[];
    feeRate: number;
};
export declare const BuildSplitTx: ({ tokenScheme, stasPayment, feePayment, destinations, note, feeRate, }: TBuildSplitTxRequest) => string;
export type TBuildMergeTxRequest = {
    tokenScheme: TokenScheme;
    outPoint1: OutPointFull;
    outPoint2: OutPointFull;
    owner: PrivateKey | Wallet;
    feePayment: TPayment;
    destination: TDestination;
    splitDestination?: TDestination;
    note?: Bytes[];
    feeRate: number;
};
export declare const BuildMergeTx: ({ tokenScheme, outPoint1, outPoint2, owner, feePayment, destination, splitDestination, note, feeRate, }: TBuildMergeTxRequest) => string;
export type TBuildRedeemTxRequest = {
    tokenScheme: TokenScheme;
    stasPayment: TPayment;
    feePayment: TPayment;
    splitDestinations?: TDestination[];
    note?: Bytes[];
    feeRate: number;
};
export declare const BuildRedeemTx: ({ tokenScheme, stasPayment, feePayment, splitDestinations, note, feeRate, }: TBuildRedeemTxRequest) => string;
//# sourceMappingURL=transaction-factory.d.ts.map