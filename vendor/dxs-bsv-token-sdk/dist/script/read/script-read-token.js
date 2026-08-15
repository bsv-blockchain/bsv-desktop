"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScriptReadToken = void 0;
const script_utils_1 = require("../script-utils");
class ScriptReadToken {
    constructor(opCodeNum, data) {
        this.OpCodeNum = opCodeNum;
        this.Data = data !== null && data !== void 0 ? data : new Uint8Array(0);
        const { valid } = (0, script_utils_1.isOpCode)(opCodeNum);
        if (valid)
            this.OpCode = opCodeNum;
    }
}
exports.ScriptReadToken = ScriptReadToken;
//# sourceMappingURL=script-read-token.js.map