"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseScriptReader = void 0;
const binary_1 = require("../../binary");
const op_codes_1 = require("../../bitcoin/op-codes");
const strict_mode_1 = require("../../security/strict-mode");
const script_read_token_1 = require("./script-read-token");
class BaseScriptReader {
    constructor(source, expectedLength) {
        this.ReadBytes = 0;
        this.Source = source;
        this.ExpectedLength = expectedLength !== null && expectedLength !== void 0 ? expectedLength : source.length;
    }
    readInternal() {
        let tokenIdx = 0;
        while (this.ReadBytes < this.ExpectedLength) {
            const opCodeNum = this.readUInt8();
            this.ReadBytes++;
            switch (opCodeNum) {
                case op_codes_1.OpCode.OP_PUSHDATA1: {
                    if (this.ReadBytes === this.ExpectedLength) {
                        if (!this.handleRest(opCodeNum, tokenIdx))
                            return -1;
                        break;
                    }
                    const count = this.readUInt8();
                    this.ReadBytes++;
                    if (!this.handleBytes(opCodeNum, count, tokenIdx, count))
                        return -1;
                    break;
                }
                case op_codes_1.OpCode.OP_PUSHDATA2: {
                    if (this.ReadBytes + 2 >= this.ExpectedLength) {
                        if (!this.handleRest(opCodeNum, tokenIdx))
                            return -1;
                        break;
                    }
                    const count = this.readUInt16Le();
                    this.ReadBytes += 2;
                    if (!this.handleBytes(opCodeNum, count, tokenIdx, count))
                        return -1;
                    break;
                }
                case op_codes_1.OpCode.OP_PUSHDATA4: {
                    if (this.ReadBytes + 4 >= this.ExpectedLength) {
                        if (!this.handleRest(opCodeNum, tokenIdx))
                            return -1;
                        break;
                    }
                    const count = this.readUInt32Le();
                    this.ReadBytes += 4;
                    if (!this.handleBytes(opCodeNum, count, tokenIdx, count))
                        return -1;
                    break;
                }
                default: {
                    if (opCodeNum > 0 && opCodeNum < op_codes_1.OpCode.OP_PUSHDATA1) {
                        const count = opCodeNum;
                        if (!this.handleBytes(opCodeNum, count, tokenIdx, count))
                            return -1;
                    }
                    else {
                        if (!this.handleTokenInternal(new script_read_token_1.ScriptReadToken(opCodeNum), tokenIdx, this.ReadBytes === this.ExpectedLength)) {
                            return -1;
                        }
                    }
                    break;
                }
            }
            tokenIdx++;
        }
        return tokenIdx;
    }
    handleTokenInternal(token, tokenIdx, isLastToken) {
        return this.handleToken(token, tokenIdx, isLastToken);
    }
    handleBytes(opCodeNum, count, tokenIdx, varInt) {
        if (count + this.ReadBytes > this.ExpectedLength) {
            if ((0, strict_mode_1.getStrictModeConfig)().strictScriptReader) {
                throw new Error("Malformed pushdata in script");
            }
            const rest = this.ExpectedLength - this.ReadBytes;
            const writer = binary_1.ByteWriter.fromSize(1 + this.varIntLength(varInt) + rest);
            writer.writeUInt8(opCodeNum);
            writer.writeVarInt(varInt);
            if (rest > 0)
                writer.writeChunk(this.readNBytes(rest));
            this.ReadBytes += rest;
            return this.handleTokenInternal(new script_read_token_1.ScriptReadToken(opCodeNum, writer.buffer), tokenIdx, this.ReadBytes === this.ExpectedLength);
        }
        const bytes = this.readNBytes(count);
        this.ReadBytes += count;
        return this.handleTokenInternal(new script_read_token_1.ScriptReadToken(opCodeNum, bytes), tokenIdx, this.ReadBytes === this.ExpectedLength);
    }
    handleRest(opCodeNum, tokenIdx) {
        if ((0, strict_mode_1.getStrictModeConfig)().strictScriptReader) {
            throw new Error("Malformed pushdata in script");
        }
        const count = this.ExpectedLength - this.ReadBytes;
        const bytes = count > 0 ? this.readNBytes(count) : undefined;
        this.ReadBytes = this.ExpectedLength;
        return this.handleTokenInternal(new script_read_token_1.ScriptReadToken(opCodeNum, bytes), tokenIdx, true);
    }
    readUInt8() {
        if (this.ReadBytes >= this.Source.length) {
            throw new Error("Read more bytes than expected");
        }
        return this.Source[this.ReadBytes];
    }
    readUInt16Le() {
        if (this.ReadBytes + 1 >= this.Source.length) {
            throw new Error("Read more bytes than expected");
        }
        return this.Source[this.ReadBytes] | (this.Source[this.ReadBytes + 1] << 8);
    }
    readUInt32Le() {
        if (this.ReadBytes + 3 >= this.Source.length) {
            throw new Error("Read more bytes than expected");
        }
        return ((this.Source[this.ReadBytes] |
            (this.Source[this.ReadBytes + 1] << 8) |
            (this.Source[this.ReadBytes + 2] << 16) |
            (this.Source[this.ReadBytes + 3] << 24)) >>>
            0);
    }
    readNBytes(count) {
        if (count < 0 || this.ReadBytes + count > this.Source.length) {
            throw new Error("Read more bytes than expected");
        }
        return this.Source.subarray(this.ReadBytes, this.ReadBytes + count);
    }
    varIntLength(value) {
        if (value < 0xfd)
            return 1;
        if (value <= 0xffff)
            return 3;
        if (value <= 0xffffffff)
            return 5;
        return 9;
    }
}
exports.BaseScriptReader = BaseScriptReader;
//# sourceMappingURL=base-script-reader.js.map