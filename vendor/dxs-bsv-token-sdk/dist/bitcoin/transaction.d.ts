import { Bytes } from "../bytes";
import { TransactionInput } from "./transaction-input";
import { TransactionOutput } from "./transaction-output";
export declare class Transaction {
    Inputs: TransactionInput[];
    Outputs: TransactionOutput[];
    Version: number;
    LockTime: number;
    Raw: Bytes;
    Hex: string;
    Id: string;
    constructor(raw: Bytes, inputs: TransactionInput[], outputs: TransactionOutput[], version: number, lockTime: number);
}
//# sourceMappingURL=transaction.d.ts.map