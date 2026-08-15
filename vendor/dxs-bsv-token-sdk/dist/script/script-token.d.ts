import { OpCode } from "../bitcoin/op-codes";
import { Bytes } from "../bytes";
export declare class ScriptToken {
    OpCodeNum: number;
    OpCode?: OpCode;
    Data?: Bytes;
    DataLength: number;
    IsReceiverId: boolean;
    IsActionData: boolean;
    IsRedemptionId: boolean;
    IsFlagsField: boolean;
    constructor(opCodeNum: number, opCode?: OpCode);
    static fromBytes(buffer: Bytes): ScriptToken;
    static fromScriptToken(from: ScriptToken): ScriptToken;
    static forSample(opCodeNum: number, dataLength?: number, isReceiverId?: boolean): ScriptToken;
}
//# sourceMappingURL=script-token.d.ts.map