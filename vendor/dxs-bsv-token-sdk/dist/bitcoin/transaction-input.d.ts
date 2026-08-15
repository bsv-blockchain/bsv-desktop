import { Address } from "./address";
import { Bytes } from "../bytes";
export declare class TransactionInput {
    TxId: string;
    Vout: number;
    UnlockingScript: Bytes;
    Sequence: number;
    constructor(txId: string, vout: number, unlockingScript: Bytes, sequence: number);
    tryGetAddress: () => Address | undefined;
}
//# sourceMappingURL=transaction-input.d.ts.map