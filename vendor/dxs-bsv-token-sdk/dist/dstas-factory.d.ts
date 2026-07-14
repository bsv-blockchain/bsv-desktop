import { Address, TPayment, TokenScheme } from "./bitcoin";
import { Bytes } from "./bytes";
import { ActionDataInput, DstasLockingParams } from "./script/build/dstas-locking-builder";
import { TDstasAssemblyPayment } from "./dstas-tx-assembly";
export type TDstasPayment = TDstasAssemblyPayment;
export type TDstasDestinationByLockingParams = {
    Satoshis: number;
    LockingParams: DstasLockingParams;
};
export type TDstasDestinationByScheme = {
    Satoshis: number;
    To?: Address;
    ToOwner?: Bytes;
    ToOwnerMultisig?: {
        m: number;
        publicKeys: string[];
    };
    ActionData?: ActionDataInput;
    Frozen?: boolean;
    OptionalData?: Bytes[];
};
export type TDstasDestination = TDstasDestinationByLockingParams | TDstasDestinationByScheme;
export type TBuildDstasBaseTxRequest = {
    stasPayments: TDstasPayment[];
    feePayment: TPayment;
    destinations: TDstasDestination[];
    scheme?: TokenScheme;
    spendingType?: number;
    note?: Bytes[];
    feeRate?: number;
    omitChangeOutput?: boolean;
};
export type TBuildDstasIssueTxsRequest = {
    fundingPayment: TPayment;
    scheme: TokenScheme;
    destinations: TDstasDestinationByScheme[];
    feeRate?: number;
};
export type TBuildDstasIssueTxsResult = {
    contractTxHex: string;
    issueTxHex: string;
};
export declare const BuildDstasBaseTx: ({ stasPayments, feePayment, destinations, scheme, spendingType, note, feeRate, omitChangeOutput, }: TBuildDstasBaseTxRequest) => string;
export declare const BuildDstasIssueTxs: ({ fundingPayment, scheme, destinations, feeRate, }: TBuildDstasIssueTxsRequest) => TBuildDstasIssueTxsResult;
export type TBuildDstasFreezeTxRequest = TBuildDstasBaseTxRequest;
export declare const BuildDstasFreezeTx: (request: TBuildDstasFreezeTxRequest) => string;
export type TBuildDstasUnfreezeTxRequest = TBuildDstasBaseTxRequest;
export declare const BuildDstasUnfreezeTx: (request: TBuildDstasUnfreezeTxRequest) => string;
export type TBuildDstasSwapTxRequest = TBuildDstasBaseTxRequest;
export declare const BuildDstasSwapTx: (request: TBuildDstasSwapTxRequest) => string;
export type TBuildDstasConfiscateTxRequest = TBuildDstasBaseTxRequest;
export declare const BuildDstasConfiscateTx: (request: TBuildDstasConfiscateTxRequest) => string;
export type TDstasSwapDestination = {
    Satoshis: number;
    Owner: Bytes;
    TokenIdHex: string;
    Freezable: boolean;
    Confiscatable?: boolean;
    FreezeAuthorityServiceField?: Bytes;
    ConfiscationAuthorityServiceField?: Bytes;
    ActionData?: ActionDataInput;
    OptionalData?: Bytes[];
};
export type TBuildDstasSwapFlowTxRequest = {
    stasPayments: [TDstasPayment, TDstasPayment];
    feePayment: TPayment;
    destinations: TDstasSwapDestination[];
    note?: Bytes[];
    feeRate?: number;
    omitChangeOutput?: boolean;
};
export type TDstasSwapMode = "auto" | "transfer-swap" | "swap-swap";
export declare const ResolveDstasSwapMode: (stasPayments: [TDstasPayment, TDstasPayment]) => Exclude<TDstasSwapMode, "auto">;
export declare const BuildDstasTransferSwapTx: ({ stasPayments, feePayment, destinations, note, feeRate, omitChangeOutput, }: TBuildDstasSwapFlowTxRequest) => string;
export declare const BuildDstasSwapSwapTx: ({ stasPayments, feePayment, destinations, note, feeRate, omitChangeOutput, }: TBuildDstasSwapFlowTxRequest) => string;
export type TBuildDstasSwapFlowAutoTxRequest = TBuildDstasSwapFlowTxRequest & {
    mode?: TDstasSwapMode;
};
export declare const BuildDstasSwapFlowTx: ({ mode, ...request }: TBuildDstasSwapFlowAutoTxRequest) => string;
export type TBuildDstasMultisigTxRequest = TBuildDstasBaseTxRequest;
export declare const BuildDstasMultisigTx: (request: TBuildDstasMultisigTxRequest) => string;
export type TBuildDstasTransferTxRequest = {
    stasPayment: TDstasPayment;
    feePayment: TPayment;
    destination: TDstasDestination;
    scheme?: TokenScheme;
    note?: Bytes[];
    feeRate?: number;
    omitChangeOutput?: boolean;
};
export declare const BuildDstasTransferTx: ({ stasPayment, feePayment, destination, scheme, note, feeRate, omitChangeOutput, }: TBuildDstasTransferTxRequest) => string;
export type TBuildDstasSplitTxRequest = {
    stasPayment: TDstasPayment;
    feePayment: TPayment;
    destinations: TDstasDestination[];
    scheme?: TokenScheme;
    note?: Bytes[];
    feeRate?: number;
};
export declare const BuildDstasSplitTx: ({ stasPayment, feePayment, destinations, scheme, note, feeRate, }: TBuildDstasSplitTxRequest) => string;
export type TBuildDstasMergeTxRequest = {
    stasPayments: [TDstasPayment, TDstasPayment];
    feePayment: TPayment;
    destinations: TDstasDestination[];
    scheme?: TokenScheme;
    note?: Bytes[];
    feeRate?: number;
};
export declare const BuildDstasMergeTx: ({ stasPayments, feePayment, destinations, scheme, note, feeRate, }: TBuildDstasMergeTxRequest) => string;
//# sourceMappingURL=dstas-factory.d.ts.map