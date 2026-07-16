"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutputBuilder = void 0;
const buffer_utils_1 = require("../../buffer/buffer-utils");
class OutputBuilder {
    constructor(lockingScript, satoshis) {
        this.LockingScript = lockingScript;
        this.Satoshis = satoshis;
    }
    size() {
        return (8 +
            (0, buffer_utils_1.estimateChunkSize)(this.LockingScript.size()));
    }
    writeTo(writer) {
        writer.writeUInt64(this.Satoshis);
        writer.writeVarChunk(this.LockingScript.toBytes());
    }
}
exports.OutputBuilder = OutputBuilder;
//# sourceMappingURL=output-builder.js.map