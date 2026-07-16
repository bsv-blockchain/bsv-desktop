"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScriptReader = void 0;
const buffer_utils_1 = require("../../buffer/buffer-utils");
const op_codes_1 = require("../../bitcoin/op-codes");
const script_token_1 = require("../script-token");
const strict_mode_1 = require("../../security/strict-mode");
class ScriptReader {
}
exports.ScriptReader = ScriptReader;
ScriptReader.read = (source) => {
    const result = [];
    let i = 0;
    while (i < source.length) {
        const byte = source[i];
        if (byte > op_codes_1.OpCode.OP_0 && byte <= op_codes_1.OpCode.OP_PUSHDATA4) {
            const d = ScriptReader.decode(source, i);
            if (d === null) {
                if ((0, strict_mode_1.getStrictModeConfig)().strictScriptReader) {
                    throw new Error(`Malformed pushdata at offset ${i}`);
                }
                return [];
            }
            i += d.size;
            if (i + d.number > source.length) {
                if ((0, strict_mode_1.getStrictModeConfig)().strictScriptReader) {
                    throw new Error(`Pushdata exceeds script length at offset ${i}`);
                }
                return [];
            }
            const data = (0, buffer_utils_1.slice)(source, i, i + d.number);
            i += d.number;
            const op = (0, buffer_utils_1.asMinimalOP)(data);
            if (op !== undefined) {
                result.push(new script_token_1.ScriptToken(op, op));
            }
            else {
                result.push(script_token_1.ScriptToken.fromBytes(data));
            }
        }
        else {
            result.push(new script_token_1.ScriptToken(byte, byte));
            i += 1;
        }
    }
    return result;
};
ScriptReader.decode = (buffer, offset) => {
    const opcode = buffer[offset];
    let num;
    let size;
    if (opcode < op_codes_1.OpCode.OP_PUSHDATA1) {
        num = opcode;
        size = 1;
    }
    else if (opcode === op_codes_1.OpCode.OP_PUSHDATA1) {
        if (offset + 2 > buffer.length)
            return null;
        num = buffer[offset + 1];
        size = 2;
    }
    else if (opcode === op_codes_1.OpCode.OP_PUSHDATA2) {
        if (offset + 3 > buffer.length)
            return null;
        num = buffer[offset + 1] | (buffer[offset + 2] << 8);
        size = 3;
    }
    else {
        if (offset + 5 > buffer.length)
            return null;
        if (opcode !== op_codes_1.OpCode.OP_PUSHDATA4)
            throw new Error("Unexpected opcode");
        num =
            (buffer[offset + 1] |
                (buffer[offset + 2] << 8) |
                (buffer[offset + 3] << 16) |
                (buffer[offset + 4] << 24)) >>>
                0;
        size = 5;
    }
    return {
        opcode,
        number: num,
        size,
    };
};
//# sourceMappingURL=script-reader.js.map