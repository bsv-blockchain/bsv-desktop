"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOpCode = void 0;
const op_codes_1 = require("../bitcoin/op-codes");
const isOpCode = (opCodeNum) => {
    if (opCodeNum === op_codes_1.OpCode.OP_0 ||
        (opCodeNum >= op_codes_1.OpCode.OP_PUSHDATA1 && opCodeNum <= op_codes_1.OpCode.OP_INVALIDOPCODE)) {
        return { valid: true, opCode: opCodeNum };
    }
    return { valid: false, opCode: op_codes_1.OpCode.OP_INVALIDOPCODE };
};
exports.isOpCode = isOpCode;
//# sourceMappingURL=script-utils.js.map