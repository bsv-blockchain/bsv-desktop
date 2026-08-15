"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.P2pkhBuilder = void 0;
const op_codes_1 = require("../../bitcoin/op-codes");
const script_type_1 = require("../../bitcoin/script-type");
const script_samples_1 = require("../script-samples");
const script_token_1 = require("../script-token");
const script_builder_1 = require("./script-builder");
class P2pkhBuilder extends script_builder_1.ScriptBuilder {
    constructor(address) {
        super(script_type_1.ScriptType.p2pkh, address);
        this._isOpReturnAdded = false;
        for (const token of script_samples_1.p2phkTokens) {
            if (token.IsReceiverId) {
                const receiver = script_token_1.ScriptToken.fromBytes(address.Hash160);
                receiver.IsReceiverId = true;
                this._tokens.push(receiver);
            }
            else {
                this._tokens.push(script_token_1.ScriptToken.fromScriptToken(token));
            }
        }
    }
    addReturnData(data) {
        if (!this._isOpReturnAdded) {
            this.addOpCode(op_codes_1.OpCode.OP_RETURN);
            this._isOpReturnAdded = true;
        }
        this.addData(data);
    }
}
exports.P2pkhBuilder = P2pkhBuilder;
//# sourceMappingURL=p2pkh-builder.js.map