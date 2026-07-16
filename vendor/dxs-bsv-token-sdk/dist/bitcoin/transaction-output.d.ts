import { Bytes } from "../bytes";
import { Address } from "./address";
import { ScriptType } from "./script-type";
export declare class TransactionOutput {
    Satoshis: number;
    private _lockingScript;
    ScriptType: ScriptType;
    Address?: Address;
    TokenId?: string;
    Symbol?: string;
    data: Bytes[];
    constructor(satoshis: number, lockingScript: Bytes);
    get LockingScript(): Bytes;
    set LockingScript(value: Bytes);
}
//# sourceMappingURL=transaction-output.d.ts.map