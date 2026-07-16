"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScriptBuilder = void 0;
const buffer_utils_1 = require("../../buffer/buffer-utils");
const binary_1 = require("../../binary");
const address_1 = require("../../bitcoin/address");
const op_codes_1 = require("../../bitcoin/op-codes");
const script_type_1 = require("../../bitcoin/script-type");
const bytes_1 = require("../../bytes");
const script_token_1 = require("../script-token");
class ScriptBuilder {
    constructor(scriptType, toAddress) {
        this._tokens = [];
        this.size = () => {
            let size = 0;
            for (const token of this._tokens) {
                size += this.tokenSize(token);
            }
            return size;
        };
        this.tokenSize = (token) => {
            const size = 1;
            const opcodeNum = token.OpCodeNum;
            const dataLength = token.DataLength;
            const add = opcodeNum > 0 && opcodeNum < op_codes_1.OpCode.OP_PUSHDATA1
                ? dataLength
                : opcodeNum === op_codes_1.OpCode.OP_PUSHDATA1
                    ? dataLength + 1
                    : opcodeNum === op_codes_1.OpCode.OP_PUSHDATA2
                        ? dataLength + 2
                        : opcodeNum === op_codes_1.OpCode.OP_PUSHDATA4
                            ? dataLength + 4
                            : 0;
            return size + add;
        };
        this.toBytes = () => {
            const buffer = new Uint8Array(this.size());
            const bufferWriter = new binary_1.ByteWriter(buffer);
            for (const token of this._tokens) {
                bufferWriter.writeUInt8(token.OpCodeNum);
                if (token.OpCodeNum > 0 && token.OpCodeNum < op_codes_1.OpCode.OP_PUSHDATA1) {
                    bufferWriter.writeChunk(token.Data);
                }
                else if (token.OpCodeNum === op_codes_1.OpCode.OP_PUSHDATA1) {
                    bufferWriter.writeUInt8(token.DataLength);
                    bufferWriter.writeChunk(token.Data);
                }
                else if (token.OpCodeNum === op_codes_1.OpCode.OP_PUSHDATA2) {
                    bufferWriter.writeUInt16(token.DataLength);
                    bufferWriter.writeChunk(token.Data);
                }
                else if (token.OpCodeNum === op_codes_1.OpCode.OP_PUSHDATA4) {
                    bufferWriter.writeUInt32(token.DataLength);
                    bufferWriter.writeChunk(token.Data);
                }
            }
            return buffer;
        };
        this.toHex = () => (0, bytes_1.toHex)(this.toBytes());
        this.addToken = (token) => {
            this._tokens.push(token);
            return this;
        };
        this.addOpCode = (opCode) => {
            this._tokens.push(new script_token_1.ScriptToken(opCode, opCode));
            return this;
        };
        this.addData = (data) => {
            this._tokens.push(script_token_1.ScriptToken.fromBytes(data));
            return this;
        };
        this.addDatas = (data) => {
            for (const chunk of data)
                this._tokens.push(script_token_1.ScriptToken.fromBytes(chunk));
            return this;
        };
        this.addNumber = (data) => {
            if (data === 0)
                this.addOpCode(op_codes_1.OpCode.OP_0);
            else if (data <= 16)
                this.addOpCode(0x50 + data);
            else
                this.addData((0, buffer_utils_1.getNumberBytes)(data));
            return this;
        };
        this.toAsm = () => {
            const opCodeKeys = Object.keys(op_codes_1.OpCode);
            const opCodeValues = Object.values(op_codes_1.OpCode);
            let result = "";
            for (const token of this._tokens) {
                if (result.length > 0)
                    result += " ";
                if (token.Data)
                    result += (0, bytes_1.toHex)(token.Data);
                else
                    result += opCodeKeys[opCodeValues.indexOf(token.OpCodeNum)];
            }
            return result;
        };
        this.ScriptType = scriptType;
        this.ToAddress = toAddress;
    }
}
exports.ScriptBuilder = ScriptBuilder;
ScriptBuilder.fromTokens = (tokens, scriptType) => {
    const toAddress = ScriptBuilder.resolveToAddress(tokens, scriptType);
    const builder = new ScriptBuilder(scriptType, toAddress);
    builder._tokens = tokens;
    return builder;
};
ScriptBuilder.resolveToAddress = (tokens, scriptType) => {
    var _a, _b;
    const fromToken = (token) => {
        if (!(token === null || token === void 0 ? void 0 : token.Data) || token.Data.length !== 20)
            return undefined;
        return new address_1.Address(token.Data);
    };
    if (scriptType === script_type_1.ScriptType.p2pkh || scriptType === script_type_1.ScriptType.p2mpkh) {
        return fromToken((_a = tokens.find((x) => x.IsReceiverId)) !== null && _a !== void 0 ? _a : tokens[2]);
    }
    if (scriptType === script_type_1.ScriptType.p2stas || scriptType === script_type_1.ScriptType.dstas) {
        return fromToken((_b = tokens.find((x) => x.IsReceiverId)) !== null && _b !== void 0 ? _b : tokens[0]);
    }
    return undefined;
};
//# sourceMappingURL=script-builder.js.map