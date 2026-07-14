"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.P2stasBuilder = void 0;
const op_codes_1 = require("../../bitcoin/op-codes");
const script_type_1 = require("../../bitcoin/script-type");
const script_samples_1 = require("../script-samples");
const script_token_1 = require("../script-token");
const script_builder_1 = require("./script-builder");
const bytes_1 = require("../../bytes");
class P2stasBuilder extends script_builder_1.ScriptBuilder {
    constructor(address, tokenId, symbol, data = []) {
        super(script_type_1.ScriptType.p2stas, address);
        const stasTokens = (0, script_samples_1.getP2stasTokens)();
        for (const token of stasTokens) {
            if (token.IsReceiverId) {
                const receiver = script_token_1.ScriptToken.fromBytes(address.Hash160);
                receiver.IsReceiverId = true;
                this._tokens.push(receiver);
            }
            else {
                this._tokens.push(script_token_1.ScriptToken.fromScriptToken(token));
            }
        }
        this.addOpCode(op_codes_1.OpCode.OP_RETURN);
        this.addData((0, bytes_1.fromHex)(tokenId));
        this.addData((0, bytes_1.utf8ToBytes)(symbol));
        for (const d of data) {
            this.addData(d);
        }
    }
}
exports.P2stasBuilder = P2stasBuilder;
//# sourceMappingURL=p2stas-builder.js.map