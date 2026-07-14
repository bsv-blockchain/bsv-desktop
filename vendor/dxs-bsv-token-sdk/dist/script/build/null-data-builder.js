"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NullDataBuilder = void 0;
const op_codes_1 = require("../../bitcoin/op-codes");
const script_type_1 = require("../../bitcoin/script-type");
const script_samples_1 = require("../script-samples");
const script_token_1 = require("../script-token");
const script_builder_1 = require("./script-builder");
class NullDataBuilder extends script_builder_1.ScriptBuilder {
    constructor(data) {
        super(script_type_1.ScriptType.nullData);
        for (const token of script_samples_1.nullDataTokens) {
            this._tokens.push(script_token_1.ScriptToken.fromScriptToken(token));
        }
        this.addOpCode(op_codes_1.OpCode.OP_RETURN);
        for (const segment of data) {
            this.addData(segment);
        }
    }
}
exports.NullDataBuilder = NullDataBuilder;
//# sourceMappingURL=null-data-builder.js.map