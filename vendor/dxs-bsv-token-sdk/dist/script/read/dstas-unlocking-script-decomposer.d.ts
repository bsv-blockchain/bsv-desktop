import { Bytes } from "../../bytes";
export type DstasUnlockingScriptDecomposition = {
    parsed: boolean;
    errors: string[];
    firstOutputSatoshis?: number;
    firstOutputReceiverPkhHex?: string;
    noteHexes: string[];
    hasExplicitEmptyNote: boolean;
    authPlaceholderOpcodes: number[];
    fundingVout?: number;
    fundingTxIdLeHex?: string;
    mergeMode: "none" | "present" | "unknown";
    counterpartyPiecesCount?: number;
    counterpartyPiecesHexes: string[];
    counterpartyScriptHex?: string;
    preimageHex?: string;
    spendingType?: number;
    signatureHex?: string;
    publicKeyHex?: string;
};
export declare const decomposeDstasUnlockingScript: (script: Bytes) => DstasUnlockingScriptDecomposition;
//# sourceMappingURL=dstas-unlocking-script-decomposer.d.ts.map