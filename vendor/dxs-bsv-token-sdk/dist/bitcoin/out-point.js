"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutPointFull = exports.OutPoint = void 0;
const transaction_1 = require("../transaction");
const script_type_1 = require("./script-type");
const strict_mode_1 = require("../security/strict-mode");
const locking_script_reader_1 = require("../script/read/locking-script-reader");
class OutPoint {
    constructor(txId, vout, lockingScript, satoshis, address, scriptType) {
        this.toString = () => `${this.TxId}:${this.Vout}`;
        this.TxId = txId;
        this.Vout = vout;
        this._lockingScript = lockingScript;
        this.Satoshis = satoshis;
        this.Address = address;
        this.ScriptType = scriptType;
        if ((0, strict_mode_1.getStrictModeConfig)().strictOutPointValidation) {
            const reader = locking_script_reader_1.LockingScriptReader.read(lockingScript);
            if (reader.ScriptType !== scriptType) {
                throw new Error(`OutPoint scriptType mismatch: expected ${scriptType}, got ${reader.ScriptType}`);
            }
            if (address && reader.Address && reader.Address.Value !== address.Value) {
                throw new Error(`OutPoint address mismatch: expected ${address.Value}, got ${reader.Address.Value}`);
            }
        }
    }
    get LockingScript() {
        return this._lockingScript;
    }
    set LockingScript(value) {
        this._lockingScript = value;
    }
}
exports.OutPoint = OutPoint;
OutPoint.fromTransaction = (transaction, vout) => new OutPointFull(transaction, vout);
OutPoint.fromHex = (hex, vout) => new OutPointFull(transaction_1.TransactionReader.readHex(hex), vout);
class OutPointFull extends OutPoint {
    constructor(transaction, vout) {
        const output = transaction.Outputs[vout];
        if (output.ScriptType !== script_type_1.ScriptType.p2pkh &&
            output.ScriptType !== script_type_1.ScriptType.p2mpkh &&
            output.ScriptType !== script_type_1.ScriptType.p2stas &&
            output.ScriptType !== script_type_1.ScriptType.dstas)
            throw new Error("p2pkh, p2mpkh, p2stas or dstas output must be provided");
        if ((output.ScriptType === script_type_1.ScriptType.p2pkh ||
            output.ScriptType === script_type_1.ScriptType.p2mpkh) &&
            !output.Address) {
            throw new Error("p2pkh and p2mpkh outputs must expose address");
        }
        super(transaction.Id, vout, output.LockingScript, output.Satoshis, output.Address, output.ScriptType);
        this.Transaction = transaction;
    }
}
exports.OutPointFull = OutPointFull;
//# sourceMappingURL=out-point.js.map