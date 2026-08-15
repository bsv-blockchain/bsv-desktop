import { Address } from "./address";
import { ScriptType } from "./script-type";
import { Transaction } from "./transaction";
import { Bytes } from "../bytes";
export declare class OutPoint {
    TxId: string;
    Vout: number;
    private _lockingScript;
    Satoshis: number;
    Address?: Address;
    ScriptType: ScriptType;
    Transaction?: Transaction;
    constructor(txId: string, vout: number, lockingScript: Bytes, satoshis: number, address: Address | undefined, scriptType: ScriptType);
    static fromTransaction: (transaction: Transaction, vout: number) => OutPointFull;
    static fromHex: (hex: string, vout: number) => OutPointFull;
    toString: () => string;
    get LockingScript(): Bytes;
    set LockingScript(value: Bytes);
}
export declare class OutPointFull extends OutPoint {
    constructor(transaction: Transaction, vout: number);
}
//# sourceMappingURL=out-point.d.ts.map