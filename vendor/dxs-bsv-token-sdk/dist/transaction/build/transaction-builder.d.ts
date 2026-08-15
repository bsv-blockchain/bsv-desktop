import { Address } from "../../bitcoin/address";
import { OutPoint } from "../../bitcoin/out-point";
import { PrivateKey } from "../../bitcoin/private-key";
import { TokenScheme } from "../../bitcoin/token-scheme";
import { InputBilder } from "./input-builder";
import { OutputBuilder } from "./output-builder";
import { Wallet } from "../../bitcoin";
import { Bytes } from "../../bytes";
export declare class TransactionBuilderError extends Error {
    devMessage: string;
    constructor(message: string, devMessage: string);
}
export declare class TransactionBuilder {
    static DefaultSequence: number;
    static DefaultSighashType: number;
    Inputs: InputBilder[];
    Outputs: OutputBuilder[];
    Version: number;
    LockTime: number;
    static init: () => TransactionBuilder;
    private validateFeeRate;
    size: () => number;
    getFee: (satoshisPerByte: number) => number;
    addInput: (outPoint: OutPoint, signer: PrivateKey | Wallet, sequence?: number) => this;
    addStasMergeInput: (outPoint: OutPoint, signer: PrivateKey | Wallet, sequence?: number) => this;
    addP2PkhOutput: (value: number, to: Address, data?: Bytes[]) => this;
    addP2MpkhOutput: (value: number, to: Address) => this;
    addNullDataOutput(data: Bytes[]): this;
    addChangeOutputWithFee(to: Address, change: number, satoshisPerByte: number, idx?: number | null): this;
    addStasOutputByScheme: (schema: TokenScheme, satoshis: number, to: Address, data?: Bytes[]) => this;
    addStasOutputByPrevLockingScript: (satoshis: number, to: Address, prevStasLockingScript: Bytes) => this;
    sign: (force?: boolean) => this;
    toBytes: () => Uint8Array<ArrayBuffer>;
    toHex: () => string;
}
//# sourceMappingURL=transaction-builder.d.ts.map