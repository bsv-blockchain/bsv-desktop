import { Bytes } from "../bytes";
export declare const enum DstasActionKind {
    swap = 1,
    confiscation = 2,
    freeze = 3
}
export type DstasSwapActionData = {
    kind: "swap";
    requestedScriptHash: Bytes;
    requestedPkh: Bytes;
    rateNumerator: number;
    rateDenominator: number;
    next?: DstasSwapActionData;
};
export type DstasActionData = {
    kind: "action";
    action: DstasActionKind.confiscation | DstasActionKind.freeze;
    payload?: Bytes;
};
export type ParsedActionData = {
    kind: "empty";
} | DstasSwapActionData | DstasActionData | {
    kind: "unknown";
    action: number;
    payload: Bytes;
};
export declare const encodeActionData: (value: DstasSwapActionData | DstasActionData) => Bytes;
export declare const decodeActionData: (bytes: Bytes) => ParsedActionData;
export declare const buildSwapActionData: (value: Omit<DstasSwapActionData, "kind">) => Bytes;
//# sourceMappingURL=dstas-action-data.d.ts.map