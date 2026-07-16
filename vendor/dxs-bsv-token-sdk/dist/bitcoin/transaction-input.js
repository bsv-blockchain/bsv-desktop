"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionInput = void 0;
const script_reader_1 = require("../script/read/script-reader");
const address_1 = require("./address");
class TransactionInput {
    constructor(txId, vout, unlockingScript, sequence) {
        this.tryGetAddress = () => {
            const scriptTokens = script_reader_1.ScriptReader.read(this.UnlockingScript);
            if (scriptTokens.length === 0)
                return undefined;
            const lastToken = scriptTokens[scriptTokens.length - 1];
            if (!(lastToken === null || lastToken === void 0 ? void 0 : lastToken.Data))
                return undefined;
            if (lastToken.DataLength === 33 &&
                (lastToken.Data[0] === 2 || lastToken.Data[0] === 3)) {
                return address_1.Address.fromPublicKey(lastToken.Data);
            }
        };
        this.TxId = txId;
        this.Vout = vout;
        this.UnlockingScript = unlockingScript;
        this.Sequence = sequence;
    }
}
exports.TransactionInput = TransactionInput;
//# sourceMappingURL=transaction-input.js.map