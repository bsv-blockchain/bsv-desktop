import { Bytes } from "../../bytes";
export type DstasActionDataField = {
    kind: "opcode";
    opcode: number;
} | {
    kind: "data";
    hex: string;
};
export type DstasLockingScriptDecomposition = {
    ownerHex?: string;
    ownerPkhHex?: string;
    actionData?: DstasActionDataField;
    baseMatched: boolean;
    redemptionPkhHex?: string;
    flagsHex?: string;
    freezeEnabled?: boolean;
    confiscationEnabled?: boolean;
    serviceFieldHexes: string[];
    optionalDataHexes: string[];
    trailingOpcodes: number[];
    errors: string[];
};
export declare const decomposeDstasLockingScript: (script: Bytes) => DstasLockingScriptDecomposition;
//# sourceMappingURL=dstas-locking-script-decomposer.d.ts.map