"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScriptToken = void 0;
const op_codes_1 = require("../bitcoin/op-codes");
const script_utils_1 = require("./script-utils");
class ScriptToken {
    constructor(opCodeNum, opCode) {
        this.DataLength = 0;
        this.IsReceiverId = false;
        this.IsActionData = false;
        this.IsRedemptionId = false;
        this.IsFlagsField = false;
        this.OpCode = opCode;
        this.OpCodeNum = opCodeNum;
    }
    static fromBytes(buffer) {
        const opCodeNum = buffer.length === 0
            ? -1
            : buffer.length < 76
                ? buffer.length
                : buffer.length <= 255
                    ? op_codes_1.OpCode.OP_PUSHDATA1
                    : buffer.length <= 65535
                        ? op_codes_1.OpCode.OP_PUSHDATA2
                        : buffer.length <= 4294967295
                            ? op_codes_1.OpCode.OP_PUSHDATA4
                            : -1;
        if (opCodeNum === -1)
            throw new Error(`No data provided: ${buffer.length}`);
        const token = new ScriptToken(opCodeNum);
        token.Data = buffer;
        token.DataLength = buffer.length;
        return token;
    }
    static fromScriptToken(from) {
        const token = from.Data
            ? ScriptToken.fromBytes(from.Data)
            : new ScriptToken(from.OpCodeNum, from.OpCode);
        token.IsReceiverId = from.IsReceiverId;
        token.IsActionData = from.IsActionData;
        token.IsRedemptionId = from.IsRedemptionId;
        token.IsFlagsField = from.IsFlagsField;
        return token;
    }
    static forSample(opCodeNum, dataLength = 0, isReceiverId = false) {
        const token = new ScriptToken(opCodeNum);
        const { valid, opCode } = (0, script_utils_1.isOpCode)(opCodeNum);
        if (valid === false)
            token.OpCode = opCode;
        token.DataLength = dataLength;
        token.IsReceiverId = isReceiverId;
        return token;
    }
}
exports.ScriptToken = ScriptToken;
//# sourceMappingURL=script-token.js.map