import { ByteReader } from "../../binary";
import { Bytes } from "../../bytes";
import { Transaction } from "../../bitcoin/transaction";
import { TransactionInput } from "../../bitcoin/transaction-input";
import { TransactionOutput } from "../../bitcoin/transaction-output";
export declare class TransactionReader {
    static readHex: (raw: string) => Transaction;
    static readBytes: (buffer: Bytes) => Transaction;
    static readInput: (reader: ByteReader) => TransactionInput;
    static readOutput: (reader: ByteReader) => TransactionOutput;
}
//# sourceMappingURL=transaction-reader.d.ts.map