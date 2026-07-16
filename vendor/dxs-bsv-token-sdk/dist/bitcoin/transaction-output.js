"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionOutput = void 0;
const locking_script_reader_1 = require("../script/read/locking-script-reader");
const bytes_1 = require("../bytes");
const script_type_1 = require("./script-type");
class TransactionOutput {
    constructor(satoshis, lockingScript) {
        var _a, _b, _c, _d;
        this.ScriptType = script_type_1.ScriptType.unknown;
        this.data = [];
        this.Satoshis = satoshis;
        this._lockingScript = lockingScript;
        const reader = locking_script_reader_1.LockingScriptReader.read(this._lockingScript);
        this.ScriptType = reader.ScriptType;
        this.Address = reader.Address;
        if (reader.ScriptType === script_type_1.ScriptType.nullData) {
            this.data = (_a = reader.Data) !== null && _a !== void 0 ? _a : [];
            return;
        }
        if (reader.ScriptType === script_type_1.ScriptType.p2pkh ||
            reader.ScriptType === script_type_1.ScriptType.p2mpkh) {
            this.data = (_b = reader.Data) !== null && _b !== void 0 ? _b : [];
            return;
        }
        if (reader.ScriptType === script_type_1.ScriptType.p2stas) {
            this.TokenId = (_c = reader.getTokenId()) !== null && _c !== void 0 ? _c : undefined;
            this.Symbol = (_d = reader.getSymbol()) !== null && _d !== void 0 ? _d : undefined;
            if (reader.Data && reader.Data.length > 2) {
                for (let i = 2; i < reader.Data.length; i++) {
                    this.data.push(reader.Data[i]);
                }
            }
            return;
        }
        if (reader.ScriptType === script_type_1.ScriptType.dstas && reader.Dstas) {
            this.TokenId = (0, bytes_1.toHex)(reader.Dstas.Redemption);
            this.data.push(reader.Dstas.Flags);
            this.data.push(...reader.Dstas.ServiceFields);
            this.data.push(...reader.Dstas.OptionalData);
        }
    }
    get LockingScript() {
        return this._lockingScript;
    }
    set LockingScript(value) {
        this._lockingScript = value;
    }
}
exports.TransactionOutput = TransactionOutput;
//# sourceMappingURL=transaction-output.js.map