import { Bytes } from "../../bytes";
import { ScriptToken } from "../script-token";
import { DstasActionData, DstasSwapActionData } from "../dstas-action-data";
export type ActionDataInput = Bytes | number | null | DstasSwapActionData | DstasActionData;
export type DstasFlagsInput = {
    freezable?: boolean;
    confiscatable?: boolean;
};
export type DstasLockingParams = {
    owner?: Bytes;
    ownerPkh?: Bytes;
    actionData: ActionDataInput;
    redemptionPkh: Bytes;
    frozen?: boolean;
    flags?: Bytes | DstasFlagsInput | null;
    serviceFields?: Bytes[];
    optionalData?: Bytes[];
};
export declare const buildDstasFlags: (flags?: DstasFlagsInput) => Bytes;
export declare const buildDstasLockingTokens: (params: DstasLockingParams) => ScriptToken[];
export declare const buildDstasLockingScript: (params: DstasLockingParams) => Bytes;
export declare const buildDstasLockingAsm: (params: DstasLockingParams) => string;
//# sourceMappingURL=dstas-locking-builder.d.ts.map