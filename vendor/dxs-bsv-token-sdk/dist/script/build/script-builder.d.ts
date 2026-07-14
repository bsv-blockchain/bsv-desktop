import { Address } from "../../bitcoin/address";
import { OpCode } from "../../bitcoin/op-codes";
import { ScriptType } from "../../bitcoin/script-type";
import { Bytes } from "../../bytes";
import { ScriptToken } from "../script-token";
export declare class ScriptBuilder {
    _tokens: ScriptToken[];
    ScriptType: ScriptType;
    ToAddress?: Address;
    constructor(scriptType: ScriptType, toAddress?: Address);
    static fromTokens: (tokens: ScriptToken[], scriptType: ScriptType) => ScriptBuilder;
    private static resolveToAddress;
    size: () => number;
    tokenSize: (token: ScriptToken) => number;
    toBytes: () => Uint8Array<ArrayBuffer>;
    toHex: () => string;
    addToken: (token: ScriptToken) => this;
    addOpCode: (opCode: OpCode) => this;
    addData: (data: Bytes) => this;
    addDatas: (data: Bytes[]) => this;
    addNumber: (data: number) => this;
    toAsm: () => string;
}
//# sourceMappingURL=script-builder.d.ts.map