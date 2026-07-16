"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asmToBytes = exports.asmToTokens = void 0;
const op_codes_1 = require("../../bitcoin/op-codes");
const script_type_1 = require("../../bitcoin/script-type");
const bytes_1 = require("../../bytes");
const script_builder_1 = require("./script-builder");
const script_token_1 = require("../script-token");
const isHex = (value) => /^[0-9a-fA-F]+$/.test(value);
const toOpcode = (token) => {
    if (token === "OP_FALSE")
        return op_codes_1.OpCode.OP_0;
    if (token === "OP_TRUE")
        return op_codes_1.OpCode.OP_1;
    const maybe = op_codes_1.OpCode[token];
    if (typeof maybe === "number")
        return maybe;
    return undefined;
};
const asmToTokens = (asm) => {
    const tokens = asm.trim().split(/\s+/).filter(Boolean);
    const result = [];
    for (const token of tokens) {
        if (token.startsWith("<") && token.endsWith(">")) {
            throw new Error(`Unresolved template placeholder: ${token}`);
        }
        if (token.startsWith("OP_")) {
            const opcode = toOpcode(token);
            if (opcode === undefined) {
                throw new Error(`Unknown opcode token: ${token}`);
            }
            result.push(new script_token_1.ScriptToken(opcode, opcode));
            continue;
        }
        if (!isHex(token)) {
            throw new Error(`Invalid ASM token: ${token}`);
        }
        const bytes = (0, bytes_1.fromHex)(token);
        result.push(script_token_1.ScriptToken.fromBytes(bytes));
    }
    return result;
};
exports.asmToTokens = asmToTokens;
const asmToBytes = (asm) => {
    const tokens = (0, exports.asmToTokens)(asm);
    const builder = script_builder_1.ScriptBuilder.fromTokens(tokens, script_type_1.ScriptType.unknown);
    return builder.toBytes();
};
exports.asmToBytes = asmToBytes;
//# sourceMappingURL=asm-template-builder.js.map