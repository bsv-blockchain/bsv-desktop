"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.P2mpkhBuilder = void 0;
const script_type_1 = require("../../bitcoin/script-type");
const script_samples_1 = require("../script-samples");
const script_token_1 = require("../script-token");
const script_builder_1 = require("./script-builder");
class P2mpkhBuilder extends script_builder_1.ScriptBuilder {
    constructor(address) {
        super(script_type_1.ScriptType.p2mpkh, address);
        for (const token of script_samples_1.p2mpkhTokens) {
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
}
exports.P2mpkhBuilder = P2mpkhBuilder;
//# sourceMappingURL=p2mpkh-builder.js.map