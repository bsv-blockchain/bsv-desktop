"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrevOutputResolverFromTransactions = exports.evaluateTransactionHex = exports.evaluateScripts = exports.SCRIPT_ENABLE_MONOLITH_OPCODES = exports.SCRIPT_ENABLE_MAGNETIC_OPCODES = exports.SCRIPT_ENABLE_SIGHASH_FORKID = void 0;
const secp256k1_1 = require("@noble/secp256k1");
const binary_1 = require("../../binary");
const buffer_utils_1 = require("../../buffer/buffer-utils");
const sig_hash_type_1 = require("../../bitcoin/sig-hash-type");
const op_codes_1 = require("../../bitcoin/op-codes");
const bytes_1 = require("../../bytes");
const hashes_1 = require("../../hashes");
const transaction_reader_1 = require("../../transaction/read/transaction-reader");
const strict_mode_1 = require("../../security/strict-mode");
exports.SCRIPT_ENABLE_SIGHASH_FORKID = 1 << 16;
exports.SCRIPT_ENABLE_MAGNETIC_OPCODES = 1 << 17;
exports.SCRIPT_ENABLE_MONOLITH_OPCODES = 1 << 18;
const DEFAULT_SCRIPT_FLAGS = exports.SCRIPT_ENABLE_SIGHASH_FORKID |
    exports.SCRIPT_ENABLE_MAGNETIC_OPCODES |
    exports.SCRIPT_ENABLE_MONOLITH_OPCODES;
class ScriptEvalError extends Error {
    constructor(message) {
        super(message);
    }
}
const isTruthy = (value) => {
    for (let i = 0; i < value.length; i++) {
        if (value[i] !== 0) {
            if (i === value.length - 1 && value[i] === 0x80)
                return false;
            return true;
        }
    }
    return false;
};
const decodeScriptNum = (value) => {
    if (value.length === 0)
        return BigInt(0);
    let result = BigInt(0);
    for (let i = 0; i < value.length; i++) {
        result |= BigInt(value[i]) << BigInt(8 * i);
    }
    const signBit = BigInt(1) << BigInt(8 * value.length - 1);
    const isNegative = (result & signBit) !== BigInt(0);
    if (isNegative) {
        result &= signBit - BigInt(1);
        return -result;
    }
    return result;
};
const encodeScriptNum = (value) => {
    if (value === BigInt(0))
        return new Uint8Array();
    const neg = value < BigInt(0);
    let absValue = neg ? -value : value;
    const result = [];
    while (absValue > BigInt(0)) {
        result.push(Number(absValue & BigInt(0xff)));
        absValue >>= BigInt(8);
    }
    if ((result[result.length - 1] & 0x80) !== 0) {
        result.push(neg ? 0x80 : 0x00);
    }
    else if (neg) {
        result[result.length - 1] |= 0x80;
    }
    return new Uint8Array(result);
};
const fromBigInt = (value) => encodeScriptNum(value);
const pushBool = (stack, value) => {
    stack.push(value ? new Uint8Array([1]) : new Uint8Array());
};
const decodePushData = (script, offset) => {
    const opcode = script[offset];
    if (opcode >= 1 && opcode <= 75) {
        const size = opcode;
        const start = offset + 1;
        const end = start + size;
        if (end > script.length)
            throw new ScriptEvalError("Push out of bounds");
        return { opcode, data: script.subarray(start, end), next: end };
    }
    if (opcode === op_codes_1.OpCode.OP_PUSHDATA1) {
        if (offset + 2 > script.length)
            throw new ScriptEvalError("Pushdata1 out of bounds");
        const size = script[offset + 1];
        const start = offset + 2;
        const end = start + size;
        if (end > script.length)
            throw new ScriptEvalError("Push out of bounds");
        return { opcode, data: script.subarray(start, end), next: end };
    }
    if (opcode === op_codes_1.OpCode.OP_PUSHDATA2) {
        if (offset + 3 > script.length)
            throw new ScriptEvalError("Pushdata2 out of bounds");
        const size = script[offset + 1] | (script[offset + 2] << 8);
        const start = offset + 3;
        const end = start + size;
        if (end > script.length)
            throw new ScriptEvalError("Push out of bounds");
        return { opcode, data: script.subarray(start, end), next: end };
    }
    if (opcode === op_codes_1.OpCode.OP_PUSHDATA4) {
        if (offset + 5 > script.length)
            throw new ScriptEvalError("Pushdata4 out of bounds");
        const size = (script[offset + 1] |
            (script[offset + 2] << 8) |
            (script[offset + 3] << 16) |
            (script[offset + 4] << 24)) >>>
            0;
        const start = offset + 5;
        const end = start + size;
        if (end > script.length)
            throw new ScriptEvalError("Push out of bounds");
        return { opcode, data: script.subarray(start, end), next: end };
    }
    return { opcode, data: undefined, next: offset + 1 };
};
const stripCodeSeparators = (script) => {
    const parts = [];
    let i = 0;
    while (i < script.length) {
        const { opcode, data, next } = decodePushData(script, i);
        if (data !== undefined) {
            parts.push(script.subarray(i, next));
        }
        else if (opcode !== op_codes_1.OpCode.OP_CODESEPARATOR) {
            parts.push(script.subarray(i, next));
        }
        i = next;
    }
    return (0, bytes_1.concat)(parts);
};
const derDecodeSignature = (der) => {
    if (der.length < 8 || der[0] !== 0x30) {
        throw new ScriptEvalError("Invalid DER signature");
    }
    const totalLen = der[1];
    if (totalLen + 2 !== der.length) {
        throw new ScriptEvalError("Invalid DER signature length");
    }
    let offset = 2;
    if (der[offset++] !== 0x02)
        throw new ScriptEvalError("Invalid DER signature");
    const rLen = der[offset++];
    const r = der.subarray(offset, offset + rLen);
    offset += rLen;
    if (der[offset++] !== 0x02)
        throw new ScriptEvalError("Invalid DER signature");
    const sLen = der[offset++];
    const s = der.subarray(offset, offset + sLen);
    const bytesToBigInt = (bytes) => {
        let result = BigInt(0);
        for (const byte of bytes) {
            result = (result << BigInt(8)) + BigInt(byte);
        }
        return result;
    };
    return new secp256k1_1.Signature(bytesToBigInt(r), bytesToBigInt(s));
};
const parseSignature = (sigWithHashType, requireDerSignatures = false) => {
    if (sigWithHashType.length === 0) {
        return { signature: new Uint8Array(), sighashType: 0 };
    }
    const sighashType = sigWithHashType[sigWithHashType.length - 1];
    const signature = sigWithHashType.subarray(0, sigWithHashType.length - 1);
    if (signature.length === 0) {
        return { signature: new Uint8Array(), sighashType };
    }
    if (requireDerSignatures && signature[0] !== 0x30) {
        throw new ScriptEvalError("Non-DER signature is rejected in strict mode");
    }
    const sigBytes = signature[0] === 0x30 ? derDecodeSignature(signature).toBytes() : signature;
    return { signature: sigBytes, sighashType };
};
const writeOutputTo = (writer, output) => {
    writer.writeUInt64(output.Satoshis);
    writer.writeVarChunk(output.LockingScript);
};
const outputSize = (output) => 8 + (0, buffer_utils_1.estimateChunkSize)(output.LockingScript.length);
const buildSighashPreimage = (ctx, scriptCode, sighashType) => {
    const tx = ctx.tx;
    const inputIdx = ctx.inputIndex;
    const baseType = sighashType & 0x1f;
    const anyoneCanPay = (sighashType & sig_hash_type_1.SignatureHashType.SIGHASH_ANYONECANPAY) !== 0;
    const prevoutHash = anyoneCanPay
        ? new Uint8Array(32)
        : (0, hashes_1.hash256)((0, bytes_1.concat)(tx.Inputs.map((input) => (0, bytes_1.concat)([
            (0, buffer_utils_1.reverseBytes)((0, bytes_1.fromHex)(input.TxId)),
            new Uint8Array([
                input.Vout & 0xff,
                (input.Vout >> 8) & 0xff,
                (input.Vout >> 16) & 0xff,
                (input.Vout >> 24) & 0xff,
            ]),
        ]))));
    const sequenceHash = anyoneCanPay ||
        baseType === sig_hash_type_1.SignatureHashType.SIGHASH_NONE ||
        baseType === sig_hash_type_1.SignatureHashType.SIGHASH_SINGLE
        ? new Uint8Array(32)
        : (0, hashes_1.hash256)((0, bytes_1.concat)(tx.Inputs.map((input) => new Uint8Array([
            input.Sequence & 0xff,
            (input.Sequence >> 8) & 0xff,
            (input.Sequence >> 16) & 0xff,
            (input.Sequence >> 24) & 0xff,
        ]))));
    let outputsHash = new Uint8Array(32);
    if (baseType === sig_hash_type_1.SignatureHashType.SIGHASH_ALL) {
        const outputsSize = tx.Outputs.reduce((sum, out) => sum + outputSize(out), 0);
        const outputsBuffer = new Uint8Array(outputsSize);
        const outputsWriter = new binary_1.ByteWriter(outputsBuffer);
        for (const output of tx.Outputs)
            writeOutputTo(outputsWriter, output);
        outputsHash = (0, hashes_1.hash256)(outputsBuffer);
    }
    else if (baseType === sig_hash_type_1.SignatureHashType.SIGHASH_SINGLE) {
        if (inputIdx < tx.Outputs.length) {
            const output = tx.Outputs[inputIdx];
            const singleBuffer = new Uint8Array(outputSize(output));
            const singleWriter = new binary_1.ByteWriter(singleBuffer);
            writeOutputTo(singleWriter, output);
            outputsHash = (0, hashes_1.hash256)(singleBuffer);
        }
    }
    const prevOutput = ctx.prevOutputs[inputIdx];
    if (!prevOutput)
        throw new ScriptEvalError("Missing prev output for input");
    const scriptChunk = stripCodeSeparators(scriptCode);
    const preimageSize = 4 + 32 + 32 + 32 + 4 + (0, buffer_utils_1.getChunkSize)(scriptChunk) + 8 + 4 + 32 + 4 + 4;
    const preimageBuffer = new Uint8Array(preimageSize);
    const preimageWriter = new binary_1.ByteWriter(preimageBuffer);
    preimageWriter.writeUInt32(tx.Version);
    preimageWriter.writeChunk(prevoutHash);
    preimageWriter.writeChunk(sequenceHash);
    preimageWriter.writeChunk((0, buffer_utils_1.reverseBytes)((0, bytes_1.fromHex)(tx.Inputs[inputIdx].TxId)));
    preimageWriter.writeUInt32(tx.Inputs[inputIdx].Vout);
    preimageWriter.writeVarChunk(scriptChunk);
    preimageWriter.writeUInt64(prevOutput.satoshis);
    preimageWriter.writeUInt32(tx.Inputs[inputIdx].Sequence);
    preimageWriter.writeChunk(outputsHash);
    preimageWriter.writeUInt32(tx.LockTime);
    preimageWriter.writeUInt32(sighashType >>> 0);
    return preimageBuffer;
};
class ScriptInterpreter {
    constructor(ctx, options) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        this.stack = [];
        this.altStack = [];
        this.execStack = [];
        this.script = new Uint8Array();
        this.codeSeparator = -1;
        this.tracePhase = "unlocking";
        this.trace = [];
        this.equalityTrace = [];
        this.opCount = 0;
        this.getStack = () => this.stack;
        this.getAltStack = () => this.altStack;
        this.getTrace = () => this.trace;
        this.getEqualityTrace = () => this.equalityTrace;
        this.setTracePhase = (phase) => {
            this.tracePhase = phase;
        };
        this.isExecuting = () => this.execStack.every((v) => v);
        this.pop = () => {
            if (this.stack.length === 0)
                throw new ScriptEvalError("Stack underflow");
            return this.stack.pop();
        };
        this.popNum = () => decodeScriptNum(this.pop());
        this.popBool = () => isTruthy(this.pop());
        this.ensureElementSize = (value) => {
            if (this.strictMode && value.length > this.maxElementSizeBytes) {
                throw new ScriptEvalError(`Script element exceeds strict limit: ${value.length} > ${this.maxElementSizeBytes}`);
            }
        };
        this.ensureStackDepth = () => {
            if (this.strictMode &&
                this.stack.length + this.altStack.length > this.maxStackDepth) {
                throw new ScriptEvalError(`Stack depth exceeds strict limit: ${this.stack.length + this.altStack.length} > ${this.maxStackDepth}`);
            }
        };
        this.push = (value) => {
            this.ensureElementSize(value);
            this.stack.push(value);
            this.ensureStackDepth();
        };
        this.top = () => {
            if (this.stack.length === 0)
                throw new ScriptEvalError("Stack underflow");
            return this.stack[this.stack.length - 1];
        };
        this.getScriptCode = () => {
            const start = this.codeSeparator + 1;
            return this.script.subarray(start);
        };
        this.hasFlag = (flag) => (this.scriptFlags & flag) !== 0;
        this.requireMonolithOpcodes = () => {
            if (!this.hasFlag(exports.SCRIPT_ENABLE_MONOLITH_OPCODES)) {
                throw new ScriptEvalError("Monolith opcodes disabled");
            }
        };
        this.requireMagneticOpcodes = () => {
            if (!this.hasFlag(exports.SCRIPT_ENABLE_MAGNETIC_OPCODES)) {
                throw new ScriptEvalError("Magnetic opcodes disabled");
            }
        };
        this.execute = (script) => {
            if (this.strictMode && script.length > this.maxScriptSizeBytes) {
                throw new ScriptEvalError(`Script exceeds strict size limit: ${script.length} > ${this.maxScriptSizeBytes}`);
            }
            this.script = script;
            this.codeSeparator = -1;
            let pc = 0;
            while (pc < script.length) {
                const { opcode, data, next } = decodePushData(script, pc);
                const executing = this.isExecuting();
                if (data !== undefined) {
                    if (executing)
                        this.push(data);
                    pc = next;
                    continue;
                }
                this.opCount++;
                if (this.strictMode && this.opCount > this.maxOps) {
                    throw new ScriptEvalError(`Opcode count exceeds strict limit: ${this.opCount} > ${this.maxOps}`);
                }
                if (!executing) {
                    if (opcode === op_codes_1.OpCode.OP_IF ||
                        opcode === op_codes_1.OpCode.OP_NOTIF ||
                        opcode === op_codes_1.OpCode.OP_ELSE ||
                        opcode === op_codes_1.OpCode.OP_ENDIF) {
                        this.execControl(opcode);
                    }
                    pc = next;
                    continue;
                }
                const halt = this.execOp(opcode, pc);
                if (this.traceEnabled) {
                    const top = this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;
                    this.trace.push({
                        phase: this.tracePhase,
                        pc,
                        opcode,
                        stackDepth: this.stack.length,
                        stackTopHex: top ? (0, bytes_1.toHex)(top) : undefined,
                        altStackDepth: this.altStack.length,
                    });
                    if (this.trace.length > this.traceLimit)
                        this.trace.shift();
                }
                if (halt)
                    break;
                pc = next;
            }
            if (this.execStack.length !== 0)
                throw new ScriptEvalError("Unbalanced conditional");
        };
        this.execControl = (opcode) => {
            if (opcode === op_codes_1.OpCode.OP_IF || opcode === op_codes_1.OpCode.OP_NOTIF) {
                if (this.isExecuting()) {
                    const cond = this.popBool();
                    this.execStack.push(opcode === op_codes_1.OpCode.OP_IF ? cond : !cond);
                }
                else {
                    this.execStack.push(false);
                }
                return;
            }
            if (opcode === op_codes_1.OpCode.OP_ELSE) {
                if (this.execStack.length === 0)
                    throw new ScriptEvalError("OP_ELSE without OP_IF");
                const parentExec = this.execStack
                    .slice(0, this.execStack.length - 1)
                    .every((v) => v);
                if (parentExec) {
                    this.execStack[this.execStack.length - 1] =
                        !this.execStack[this.execStack.length - 1];
                }
                return;
            }
            if (opcode === op_codes_1.OpCode.OP_ENDIF) {
                if (this.execStack.length === 0)
                    throw new ScriptEvalError("OP_ENDIF without OP_IF");
                this.execStack.pop();
            }
        };
        this.execOp = (opcode, pc) => {
            switch (opcode) {
                case op_codes_1.OpCode.OP_0:
                    this.push(new Uint8Array());
                    return;
                case op_codes_1.OpCode.OP_1NEGATE:
                    this.push(fromBigInt(BigInt(-1)));
                    return;
                case op_codes_1.OpCode.OP_1:
                case op_codes_1.OpCode.OP_2:
                case op_codes_1.OpCode.OP_3:
                case op_codes_1.OpCode.OP_4:
                case op_codes_1.OpCode.OP_5:
                case op_codes_1.OpCode.OP_6:
                case op_codes_1.OpCode.OP_7:
                case op_codes_1.OpCode.OP_8:
                case op_codes_1.OpCode.OP_9:
                case op_codes_1.OpCode.OP_10:
                case op_codes_1.OpCode.OP_11:
                case op_codes_1.OpCode.OP_12:
                case op_codes_1.OpCode.OP_13:
                case op_codes_1.OpCode.OP_14:
                case op_codes_1.OpCode.OP_15:
                case op_codes_1.OpCode.OP_16:
                    this.push(fromBigInt(BigInt(opcode - op_codes_1.OpCode.OP_1 + 1)));
                    return;
                case op_codes_1.OpCode.OP_NOP:
                case op_codes_1.OpCode.OP_NOP1:
                case op_codes_1.OpCode.OP_NOP4:
                case op_codes_1.OpCode.OP_NOP5:
                case op_codes_1.OpCode.OP_NOP6:
                case op_codes_1.OpCode.OP_NOP7:
                case op_codes_1.OpCode.OP_NOP8:
                case op_codes_1.OpCode.OP_NOP9:
                case op_codes_1.OpCode.OP_NOP10:
                    return;
                case op_codes_1.OpCode.OP_VERIFY: {
                    const ok = this.popBool();
                    if (!ok)
                        throw new ScriptEvalError("OP_VERIFY failed");
                    return;
                }
                case op_codes_1.OpCode.OP_RETURN:
                    if (this.allowOpReturn)
                        return true;
                    throw new ScriptEvalError("OP_RETURN");
                case op_codes_1.OpCode.OP_IF:
                case op_codes_1.OpCode.OP_NOTIF:
                case op_codes_1.OpCode.OP_ELSE:
                case op_codes_1.OpCode.OP_ENDIF:
                    return this.execControl(opcode);
                case op_codes_1.OpCode.OP_TOALTSTACK:
                    this.altStack.push(this.pop());
                    this.ensureStackDepth();
                    return;
                case op_codes_1.OpCode.OP_FROMALTSTACK:
                    if (this.altStack.length === 0)
                        throw new ScriptEvalError("Alt stack underflow");
                    this.push(this.altStack.pop());
                    return;
                case op_codes_1.OpCode.OP_2DROP:
                    this.pop();
                    this.pop();
                    return;
                case op_codes_1.OpCode.OP_2DUP: {
                    const a = this.pop();
                    const b = this.pop();
                    this.push(b);
                    this.push(a);
                    this.push((0, buffer_utils_1.cloneBytes)(b));
                    this.push((0, buffer_utils_1.cloneBytes)(a));
                    return;
                }
                case op_codes_1.OpCode.OP_3DUP: {
                    const a = this.pop();
                    const b = this.pop();
                    const c = this.pop();
                    this.push(c);
                    this.push(b);
                    this.push(a);
                    this.push((0, buffer_utils_1.cloneBytes)(c));
                    this.push((0, buffer_utils_1.cloneBytes)(b));
                    this.push((0, buffer_utils_1.cloneBytes)(a));
                    return;
                }
                case op_codes_1.OpCode.OP_2OVER: {
                    if (this.stack.length < 4)
                        throw new ScriptEvalError("Stack underflow");
                    this.push((0, buffer_utils_1.cloneBytes)(this.stack[this.stack.length - 4]));
                    this.push((0, buffer_utils_1.cloneBytes)(this.stack[this.stack.length - 3]));
                    return;
                }
                case op_codes_1.OpCode.OP_2ROT: {
                    if (this.stack.length < 6)
                        throw new ScriptEvalError("Stack underflow");
                    const a = this.stack.splice(this.stack.length - 6, 2);
                    this.stack.push(a[0], a[1]);
                    return;
                }
                case op_codes_1.OpCode.OP_2SWAP: {
                    if (this.stack.length < 4)
                        throw new ScriptEvalError("Stack underflow");
                    const a = this.stack.splice(this.stack.length - 4, 2);
                    this.stack.push(a[0], a[1]);
                    return;
                }
                case op_codes_1.OpCode.OP_IFDUP: {
                    if (this.stack.length === 0)
                        throw new ScriptEvalError("Stack underflow");
                    if (isTruthy(this.top()))
                        this.push((0, buffer_utils_1.cloneBytes)(this.top()));
                    return;
                }
                case op_codes_1.OpCode.OP_DEPTH:
                    this.push(fromBigInt(BigInt(this.stack.length)));
                    return;
                case op_codes_1.OpCode.OP_DROP:
                    this.pop();
                    return;
                case op_codes_1.OpCode.OP_DUP:
                    this.push((0, buffer_utils_1.cloneBytes)(this.top()));
                    return;
                case op_codes_1.OpCode.OP_NIP: {
                    const a = this.pop();
                    this.pop();
                    this.push(a);
                    return;
                }
                case op_codes_1.OpCode.OP_OVER: {
                    if (this.stack.length < 2)
                        throw new ScriptEvalError("Stack underflow");
                    this.push((0, buffer_utils_1.cloneBytes)(this.stack[this.stack.length - 2]));
                    return;
                }
                case op_codes_1.OpCode.OP_PICK: {
                    const n = Number(this.popNum());
                    if (n < 0 || n >= this.stack.length)
                        throw new ScriptEvalError("OP_PICK out of range");
                    this.push((0, buffer_utils_1.cloneBytes)(this.stack[this.stack.length - 1 - n]));
                    return;
                }
                case op_codes_1.OpCode.OP_ROLL: {
                    const n = Number(this.popNum());
                    if (n < 0 || n >= this.stack.length)
                        throw new ScriptEvalError("OP_ROLL out of range");
                    const idx = this.stack.length - 1 - n;
                    const [val] = this.stack.splice(idx, 1);
                    this.push(val);
                    return;
                }
                case op_codes_1.OpCode.OP_ROT: {
                    if (this.stack.length < 3)
                        throw new ScriptEvalError("Stack underflow");
                    const a = this.stack.splice(this.stack.length - 3, 1)[0];
                    this.stack.push(a);
                    return;
                }
                case op_codes_1.OpCode.OP_SWAP: {
                    if (this.stack.length < 2)
                        throw new ScriptEvalError("Stack underflow");
                    const a = this.pop();
                    const b = this.pop();
                    this.push(a);
                    this.push(b);
                    return;
                }
                case op_codes_1.OpCode.OP_TUCK: {
                    if (this.stack.length < 2)
                        throw new ScriptEvalError("Stack underflow");
                    const a = this.pop();
                    const b = this.pop();
                    this.push((0, buffer_utils_1.cloneBytes)(a));
                    this.push(b);
                    this.push(a);
                    return;
                }
                case op_codes_1.OpCode.OP_CAT: {
                    this.requireMonolithOpcodes();
                    const b = this.pop();
                    const a = this.pop();
                    this.push((0, bytes_1.concat)([a, b]));
                    return;
                }
                case op_codes_1.OpCode.OP_SPLIT: {
                    this.requireMonolithOpcodes();
                    const pos = Number(this.popNum());
                    const data = this.pop();
                    if (pos < 0 || pos > data.length)
                        throw new ScriptEvalError("OP_SPLIT out of range");
                    this.push(data.subarray(0, pos));
                    this.push(data.subarray(pos));
                    return;
                }
                case op_codes_1.OpCode.OP_NUM2BIN: {
                    this.requireMonolithOpcodes();
                    const size = Number(this.popNum());
                    const num = this.popNum();
                    if (size < 0)
                        throw new ScriptEvalError("OP_NUM2BIN size < 0");
                    if (size === 0) {
                        if (num !== BigInt(0))
                            throw new ScriptEvalError("OP_NUM2BIN overflow");
                        this.push(new Uint8Array());
                        return;
                    }
                    const minimal = fromBigInt(num);
                    if (minimal.length > size)
                        throw new ScriptEvalError("OP_NUM2BIN overflow");
                    if (minimal.length === size) {
                        this.push(minimal);
                        return;
                    }
                    const out = new Uint8Array(size);
                    out.set(minimal);
                    if (num < BigInt(0)) {
                        if (minimal.length > 0) {
                            out[minimal.length - 1] &= 0x7f;
                        }
                        out[size - 1] |= 0x80;
                    }
                    this.push(out);
                    return;
                }
                case op_codes_1.OpCode.OP_BIN2NUM: {
                    this.requireMonolithOpcodes();
                    const num = this.popNum();
                    this.push(fromBigInt(num));
                    return;
                }
                case op_codes_1.OpCode.OP_SIZE: {
                    this.push(fromBigInt(BigInt(this.top().length)));
                    return;
                }
                case op_codes_1.OpCode.OP_INVERT: {
                    this.requireMonolithOpcodes();
                    const data = this.pop();
                    const out = new Uint8Array(data.length);
                    for (let i = 0; i < data.length; i++)
                        out[i] = data[i] ^ 0xff;
                    this.push(out);
                    return;
                }
                case op_codes_1.OpCode.OP_AND:
                case op_codes_1.OpCode.OP_OR:
                case op_codes_1.OpCode.OP_XOR: {
                    this.requireMonolithOpcodes();
                    const b = this.pop();
                    const a = this.pop();
                    if (a.length !== b.length)
                        throw new ScriptEvalError("Bitwise length mismatch");
                    const out = new Uint8Array(a.length);
                    for (let i = 0; i < a.length; i++) {
                        if (opcode === op_codes_1.OpCode.OP_AND)
                            out[i] = a[i] & b[i];
                        else if (opcode === op_codes_1.OpCode.OP_OR)
                            out[i] = a[i] | b[i];
                        else
                            out[i] = a[i] ^ b[i];
                    }
                    this.push(out);
                    return;
                }
                case op_codes_1.OpCode.OP_EQUAL: {
                    const b = this.pop();
                    const a = this.pop();
                    const ok = (0, bytes_1.equal)(a, b);
                    if (this.traceEnabled) {
                        this.equalityTrace.push({
                            phase: this.tracePhase,
                            pc,
                            opcode,
                            leftHex: (0, bytes_1.toHex)(a),
                            rightHex: (0, bytes_1.toHex)(b),
                            result: ok,
                        });
                        if (this.equalityTrace.length > this.traceLimit)
                            this.equalityTrace.shift();
                    }
                    pushBool(this.stack, ok);
                    return;
                }
                case op_codes_1.OpCode.OP_EQUALVERIFY: {
                    const b = this.pop();
                    const a = this.pop();
                    const ok = (0, bytes_1.equal)(a, b);
                    if (this.traceEnabled) {
                        this.equalityTrace.push({
                            phase: this.tracePhase,
                            pc,
                            opcode,
                            leftHex: (0, bytes_1.toHex)(a),
                            rightHex: (0, bytes_1.toHex)(b),
                            result: ok,
                        });
                        if (this.equalityTrace.length > this.traceLimit)
                            this.equalityTrace.shift();
                    }
                    if (!ok)
                        throw new ScriptEvalError("OP_EQUALVERIFY failed");
                    return;
                }
                case op_codes_1.OpCode.OP_1ADD:
                    this.push(fromBigInt(this.popNum() + BigInt(1)));
                    return;
                case op_codes_1.OpCode.OP_1SUB:
                    this.push(fromBigInt(this.popNum() - BigInt(1)));
                    return;
                case op_codes_1.OpCode.OP_2MUL:
                    this.push(fromBigInt(this.popNum() * BigInt(2)));
                    return;
                case op_codes_1.OpCode.OP_2DIV:
                    this.push(fromBigInt(this.popNum() / BigInt(2)));
                    return;
                case op_codes_1.OpCode.OP_NEGATE:
                    this.push(fromBigInt(-this.popNum()));
                    return;
                case op_codes_1.OpCode.OP_ABS: {
                    const n = this.popNum();
                    this.push(fromBigInt(n < BigInt(0) ? -n : n));
                    return;
                }
                case op_codes_1.OpCode.OP_NOT:
                    pushBool(this.stack, this.popNum() === BigInt(0));
                    return;
                case op_codes_1.OpCode.OP_0NOTEQUAL:
                    pushBool(this.stack, this.popNum() !== BigInt(0));
                    return;
                case op_codes_1.OpCode.OP_ADD: {
                    const b = this.popNum();
                    const a = this.popNum();
                    this.push(fromBigInt(a + b));
                    return;
                }
                case op_codes_1.OpCode.OP_SUB: {
                    const b = this.popNum();
                    const a = this.popNum();
                    this.push(fromBigInt(a - b));
                    return;
                }
                case op_codes_1.OpCode.OP_MUL: {
                    this.requireMagneticOpcodes();
                    const b = this.popNum();
                    const a = this.popNum();
                    this.push(fromBigInt(a * b));
                    return;
                }
                case op_codes_1.OpCode.OP_DIV: {
                    this.requireMagneticOpcodes();
                    const b = this.popNum();
                    if (b === BigInt(0))
                        throw new ScriptEvalError("OP_DIV by zero");
                    const a = this.popNum();
                    this.push(fromBigInt(a / b));
                    return;
                }
                case op_codes_1.OpCode.OP_MOD: {
                    this.requireMagneticOpcodes();
                    const b = this.popNum();
                    if (b === BigInt(0))
                        throw new ScriptEvalError("OP_MOD by zero");
                    const a = this.popNum();
                    this.push(fromBigInt(a % b));
                    return;
                }
                case op_codes_1.OpCode.OP_LSHIFT: {
                    this.requireMagneticOpcodes();
                    const b = this.popNum();
                    const a = this.popNum();
                    this.push(fromBigInt(a << b));
                    return;
                }
                case op_codes_1.OpCode.OP_RSHIFT: {
                    this.requireMagneticOpcodes();
                    const b = this.popNum();
                    const a = this.popNum();
                    this.push(fromBigInt(a >> b));
                    return;
                }
                case op_codes_1.OpCode.OP_BOOLAND: {
                    const b = this.popNum();
                    const a = this.popNum();
                    pushBool(this.stack, a !== BigInt(0) && b !== BigInt(0));
                    return;
                }
                case op_codes_1.OpCode.OP_BOOLOR: {
                    const b = this.popNum();
                    const a = this.popNum();
                    pushBool(this.stack, a !== BigInt(0) || b !== BigInt(0));
                    return;
                }
                case op_codes_1.OpCode.OP_NUMEQUAL: {
                    const b = this.popNum();
                    const a = this.popNum();
                    pushBool(this.stack, a === b);
                    return;
                }
                case op_codes_1.OpCode.OP_NUMEQUALVERIFY: {
                    const b = this.popNum();
                    const a = this.popNum();
                    if (a !== b)
                        throw new ScriptEvalError("OP_NUMEQUALVERIFY failed");
                    return;
                }
                case op_codes_1.OpCode.OP_NUMNOTEQUAL: {
                    const b = this.popNum();
                    const a = this.popNum();
                    pushBool(this.stack, a !== b);
                    return;
                }
                case op_codes_1.OpCode.OP_LESSTHAN: {
                    const b = this.popNum();
                    const a = this.popNum();
                    pushBool(this.stack, a < b);
                    return;
                }
                case op_codes_1.OpCode.OP_GREATERTHAN: {
                    const b = this.popNum();
                    const a = this.popNum();
                    pushBool(this.stack, a > b);
                    return;
                }
                case op_codes_1.OpCode.OP_LESSTHANOREQUAL: {
                    const b = this.popNum();
                    const a = this.popNum();
                    pushBool(this.stack, a <= b);
                    return;
                }
                case op_codes_1.OpCode.OP_GREATERTHANOREQUAL: {
                    const b = this.popNum();
                    const a = this.popNum();
                    pushBool(this.stack, a >= b);
                    return;
                }
                case op_codes_1.OpCode.OP_MIN: {
                    const b = this.popNum();
                    const a = this.popNum();
                    this.push(fromBigInt(a < b ? a : b));
                    return;
                }
                case op_codes_1.OpCode.OP_MAX: {
                    const b = this.popNum();
                    const a = this.popNum();
                    this.push(fromBigInt(a > b ? a : b));
                    return;
                }
                case op_codes_1.OpCode.OP_WITHIN: {
                    const max = this.popNum();
                    const min = this.popNum();
                    const x = this.popNum();
                    pushBool(this.stack, x >= min && x < max);
                    return;
                }
                case op_codes_1.OpCode.OP_RIPEMD160: {
                    const data = this.pop();
                    this.push((0, hashes_1.ripemd160)(data));
                    return;
                }
                case op_codes_1.OpCode.OP_SHA1:
                    throw new ScriptEvalError("OP_SHA1 not supported");
                case op_codes_1.OpCode.OP_SHA256: {
                    const data = this.pop();
                    this.push((0, hashes_1.sha256)(data));
                    return;
                }
                case op_codes_1.OpCode.OP_HASH160: {
                    const data = this.pop();
                    this.push((0, hashes_1.hash160)(data));
                    return;
                }
                case op_codes_1.OpCode.OP_HASH256: {
                    const data = this.pop();
                    this.push((0, hashes_1.hash256)(data));
                    return;
                }
                case op_codes_1.OpCode.OP_CODESEPARATOR:
                    this.codeSeparator = pc;
                    return;
                case op_codes_1.OpCode.OP_CHECKSIG:
                case op_codes_1.OpCode.OP_CHECKSIGVERIFY: {
                    const pubKey = this.pop();
                    const sigWithType = this.pop();
                    const { signature, sighashType } = parseSignature(sigWithType, this.requireDerSignatures);
                    const requireForkId = this.hasFlag(exports.SCRIPT_ENABLE_SIGHASH_FORKID);
                    const hasForkId = (sighashType & sig_hash_type_1.SignatureHashType.SIGHASH_FORKID) ===
                        sig_hash_type_1.SignatureHashType.SIGHASH_FORKID;
                    if (requireForkId && !hasForkId) {
                        if (opcode === op_codes_1.OpCode.OP_CHECKSIGVERIFY) {
                            throw new ScriptEvalError("OP_CHECKSIGVERIFY missing FORKID");
                        }
                        pushBool(this.stack, false);
                        return;
                    }
                    const scriptCode = this.getScriptCode();
                    const preimage = buildSighashPreimage(this.ctx, scriptCode, sighashType);
                    const msg = (0, hashes_1.hash256)(preimage);
                    const ok = (() => {
                        try {
                            return (signature.length > 0 &&
                                (0, secp256k1_1.verify)(signature, msg, pubKey, {
                                    prehash: false,
                                    format: "compact",
                                }));
                        }
                        catch (_a) {
                            return false;
                        }
                    })();
                    if (opcode === op_codes_1.OpCode.OP_CHECKSIGVERIFY) {
                        if (!ok)
                            throw new ScriptEvalError("OP_CHECKSIGVERIFY failed");
                        return;
                    }
                    pushBool(this.stack, ok);
                    return;
                }
                case op_codes_1.OpCode.OP_CHECKMULTISIG:
                case op_codes_1.OpCode.OP_CHECKMULTISIGVERIFY: {
                    const n = Number(this.popNum());
                    if (n < 0 || n > this.stack.length)
                        throw new ScriptEvalError("OP_CHECKMULTISIG invalid pubkey count");
                    const pubKeys = this.stack.splice(this.stack.length - n, n);
                    const m = Number(this.popNum());
                    if (m < 0 || m > this.stack.length)
                        throw new ScriptEvalError("OP_CHECKMULTISIG invalid sig count");
                    const sigs = this.stack.splice(this.stack.length - m, m);
                    this.pop();
                    let sigIdx = 0;
                    let keyIdx = 0;
                    let ok = false;
                    try {
                        while (sigIdx < m && keyIdx < n) {
                            const { signature, sighashType } = parseSignature(sigs[sigIdx], this.requireDerSignatures);
                            const requireForkId = this.hasFlag(exports.SCRIPT_ENABLE_SIGHASH_FORKID);
                            const hasForkId = (sighashType & sig_hash_type_1.SignatureHashType.SIGHASH_FORKID) ===
                                sig_hash_type_1.SignatureHashType.SIGHASH_FORKID;
                            if (requireForkId && !hasForkId) {
                                keyIdx++;
                                continue;
                            }
                            const scriptCode = this.getScriptCode();
                            const preimage = buildSighashPreimage(this.ctx, scriptCode, sighashType);
                            const msg = (0, hashes_1.hash256)(preimage);
                            const matched = signature.length > 0 &&
                                (0, secp256k1_1.verify)(signature, msg, pubKeys[keyIdx], {
                                    prehash: false,
                                    format: "compact",
                                });
                            if (matched)
                                sigIdx++;
                            keyIdx++;
                        }
                        ok = sigIdx === m;
                    }
                    catch (_a) {
                        ok = false;
                    }
                    const success = ok;
                    if (opcode === op_codes_1.OpCode.OP_CHECKMULTISIGVERIFY) {
                        if (!success)
                            throw new ScriptEvalError("OP_CHECKMULTISIGVERIFY failed");
                        return;
                    }
                    pushBool(this.stack, success);
                    return;
                }
                case op_codes_1.OpCode.OP_CHECKLOCKTIMEVERIFY: {
                    const locktime = Number(decodeScriptNum(this.top()));
                    if (locktime < 0)
                        throw new ScriptEvalError("CLTV negative");
                    const txLock = this.ctx.tx.LockTime;
                    const txInput = this.ctx.tx.Inputs[this.ctx.inputIndex];
                    if (txInput.Sequence === 0xffffffff)
                        throw new ScriptEvalError("CLTV disabled by sequence");
                    if ((locktime < 500000000 && txLock >= 500000000) ||
                        (locktime >= 500000000 && txLock < 500000000))
                        throw new ScriptEvalError("CLTV locktime type mismatch");
                    if (txLock < locktime)
                        throw new ScriptEvalError("CLTV not yet reached");
                    return;
                }
                case op_codes_1.OpCode.OP_CHECKSEQUENCEVERIFY:
                    throw new ScriptEvalError("OP_CHECKSEQUENCEVERIFY not supported");
                case op_codes_1.OpCode.OP_RESERVED:
                case op_codes_1.OpCode.OP_VER:
                case op_codes_1.OpCode.OP_VERIF:
                case op_codes_1.OpCode.OP_VERNOTIF:
                case op_codes_1.OpCode.OP_RESERVED1:
                case op_codes_1.OpCode.OP_RESERVED2:
                    throw new ScriptEvalError("Disabled opcode");
                default:
                    throw new ScriptEvalError(`Unsupported opcode: 0x${opcode.toString(16)}`);
            }
        };
        const strictConfig = (0, strict_mode_1.getStrictModeConfig)();
        const strict = (_a = options === null || options === void 0 ? void 0 : options.strict) !== null && _a !== void 0 ? _a : strictConfig.strictScriptEvaluation;
        this.ctx = ctx;
        this.allowOpReturn = (options === null || options === void 0 ? void 0 : options.allowOpReturn) === true;
        this.scriptFlags = (_b = options === null || options === void 0 ? void 0 : options.scriptFlags) !== null && _b !== void 0 ? _b : DEFAULT_SCRIPT_FLAGS;
        this.traceEnabled = (options === null || options === void 0 ? void 0 : options.trace) === true;
        this.traceLimit = (_c = options === null || options === void 0 ? void 0 : options.traceLimit) !== null && _c !== void 0 ? _c : 400;
        this.strictMode = strict;
        this.requireDerSignatures = (_d = options === null || options === void 0 ? void 0 : options.requireDerSignatures) !== null && _d !== void 0 ? _d : strict;
        this.maxScriptSizeBytes =
            (_e = options === null || options === void 0 ? void 0 : options.maxScriptSizeBytes) !== null && _e !== void 0 ? _e : strictConfig.scriptEvaluationLimits.maxScriptSizeBytes;
        this.maxOps = (_f = options === null || options === void 0 ? void 0 : options.maxOps) !== null && _f !== void 0 ? _f : strictConfig.scriptEvaluationLimits.maxOps;
        this.maxStackDepth =
            (_g = options === null || options === void 0 ? void 0 : options.maxStackDepth) !== null && _g !== void 0 ? _g : strictConfig.scriptEvaluationLimits.maxStackDepth;
        this.maxElementSizeBytes =
            (_h = options === null || options === void 0 ? void 0 : options.maxElementSizeBytes) !== null && _h !== void 0 ? _h : strictConfig.scriptEvaluationLimits.maxElementSizeBytes;
    }
}
const evaluateScripts = (unlockingScript, lockingScript, ctx, options) => {
    const interpreter = new ScriptInterpreter(ctx, options);
    try {
        interpreter.setTracePhase("unlocking");
        interpreter.execute(unlockingScript);
        interpreter.setTracePhase("locking");
        interpreter.execute(lockingScript);
        const stack = interpreter.getStack();
        const success = stack.length > 0 && isTruthy(stack[stack.length - 1]);
        return {
            success,
            stack,
            altStack: interpreter.getAltStack(),
            trace: interpreter.getTrace(),
            equalityTrace: interpreter.getEqualityTrace(),
            error: success ? undefined : "Script evaluated to false",
        };
    }
    catch (err) {
        return {
            success: false,
            stack: interpreter.getStack(),
            altStack: interpreter.getAltStack(),
            trace: interpreter.getTrace(),
            equalityTrace: interpreter.getEqualityTrace(),
            error: err instanceof Error ? err.message : "Script error",
        };
    }
};
exports.evaluateScripts = evaluateScripts;
const evaluateTransactionHex = (txHex, resolvePrevOutput, options) => {
    const tx = transaction_reader_1.TransactionReader.readHex(txHex);
    const inputResults = [];
    const errors = [];
    const prevOutputs = [];
    for (let i = 0; i < tx.Inputs.length; i++) {
        const input = tx.Inputs[i];
        const prev = resolvePrevOutput(input.TxId, input.Vout);
        if (!prev) {
            const error = `Missing prev output for input ${i}: ${input.TxId}:${input.Vout}`;
            inputResults.push({ inputIndex: i, success: false, error });
            errors.push(error);
            prevOutputs.push({ lockingScript: new Uint8Array(), satoshis: 0 });
            continue;
        }
        prevOutputs.push(prev);
    }
    for (let i = 0; i < tx.Inputs.length; i++) {
        if (inputResults.some((r) => r.inputIndex === i && !r.success))
            continue;
        const result = (0, exports.evaluateScripts)(tx.Inputs[i].UnlockingScript, prevOutputs[i].lockingScript, { tx, inputIndex: i, prevOutputs }, options);
        if (!result.success) {
            inputResults.push({
                inputIndex: i,
                success: false,
                error: result.error,
            });
            errors.push(`Input ${i} failed: ${result.error}`);
        }
        else {
            inputResults.push({ inputIndex: i, success: true });
        }
    }
    return {
        txId: tx.Id,
        success: inputResults.every((r) => r.success),
        inputs: inputResults.sort((a, b) => a.inputIndex - b.inputIndex),
        errors,
    };
};
exports.evaluateTransactionHex = evaluateTransactionHex;
const createPrevOutputResolverFromTransactions = (txMap) => {
    return (txId, vout) => {
        const tx = txMap.get(txId);
        if (!tx)
            return undefined;
        const output = tx.Outputs[vout];
        if (!output)
            return undefined;
        return {
            lockingScript: output.LockingScript,
            satoshis: output.Satoshis,
        };
    };
};
exports.createPrevOutputResolverFromTransactions = createPrevOutputResolverFromTransactions;
//# sourceMappingURL=script-evaluator.js.map