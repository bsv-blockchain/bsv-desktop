"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScriptType = void 0;
var ScriptType;
(function (ScriptType) {
    ScriptType[ScriptType["unknown"] = 0] = "unknown";
    ScriptType[ScriptType["p2pk"] = 1] = "p2pk";
    ScriptType[ScriptType["p2pkh"] = 2] = "p2pkh";
    ScriptType[ScriptType["p2sh"] = 3] = "p2sh";
    ScriptType[ScriptType["p2ms"] = 4] = "p2ms";
    ScriptType[ScriptType["nullData"] = 5] = "nullData";
    ScriptType[ScriptType["p2stas"] = 6] = "p2stas";
    ScriptType[ScriptType["dstas"] = 7] = "dstas";
    ScriptType[ScriptType["p2mpkh"] = 8] = "p2mpkh";
})(ScriptType || (exports.ScriptType = ScriptType = {}));
//# sourceMappingURL=script-type.js.map