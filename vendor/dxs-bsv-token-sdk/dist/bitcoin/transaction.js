"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transaction = void 0;
const buffer_utils_1 = require("../buffer/buffer-utils");
const bytes_1 = require("../bytes");
const hashes_1 = require("../hashes");
class Transaction {
    constructor(raw, inputs, outputs, version, lockTime) {
        this.Inputs = inputs;
        this.Outputs = outputs;
        this.Version = version;
        this.LockTime = lockTime;
        this.Raw = raw;
        this.Hex = (0, bytes_1.toHex)(raw);
        this.Id = (0, bytes_1.toHex)((0, buffer_utils_1.reverseBytes)((0, hashes_1.hash256)(raw)));
    }
}
exports.Transaction = Transaction;
//# sourceMappingURL=transaction.js.map