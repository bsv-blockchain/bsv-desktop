"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockingScriptReader = void 0;
const address_1 = require("../../bitcoin/address");
const op_codes_1 = require("../../bitcoin/op-codes");
const script_type_1 = require("../../bitcoin/script-type");
const bytes_1 = require("../../bytes");
const dstas_locking_template_base_1 = require("../templates/dstas-locking-template-base");
const script_samples_1 = require("../script-samples");
const base_script_reader_1 = require("./base-script-reader");
const dstas_action_data_1 = require("../dstas-action-data");
const identity_field_1 = require("../identity-field");
class LockingScriptReader extends base_script_reader_1.BaseScriptReader {
    get ScriptType() {
        if (this.ScriptTypeOverride !== undefined)
            return this.ScriptTypeOverride;
        for (const sample of this.samples) {
            if (sample.ctx.Result)
                return sample.type;
        }
        return script_type_1.ScriptType.unknown;
    }
    constructor(bytes, expectedLength) {
        super(bytes, expectedLength);
        this.samples = [
            {
                type: script_type_1.ScriptType.p2pkh,
                tokens: script_samples_1.p2phkTokens,
                ctx: { Result: true, OpReturnReached: false },
            },
            {
                type: script_type_1.ScriptType.p2mpkh,
                tokens: script_samples_1.p2mpkhTokens,
                ctx: { Result: true, OpReturnReached: false },
            },
            {
                type: script_type_1.ScriptType.p2stas,
                tokens: (0, script_samples_1.getP2stasTokens)(),
                ctx: { Result: true, OpReturnReached: false },
            },
            {
                type: script_type_1.ScriptType.nullData,
                tokens: script_samples_1.nullDataTokens,
                ctx: { Result: true, OpReturnReached: false },
            },
        ];
        this.dstasBaseTokens = (0, dstas_locking_template_base_1.buildDstasTemplateBaseTokens)();
        this.dstasCtx = {
            Result: true,
            Stage: "owner",
            BaseIdx: 0,
            FreezeEnabled: false,
            ConfiscationEnabled: false,
            ExpectedServiceFieldsCount: 0,
            ServiceFields: [],
            OptionalData: [],
        };
    }
    read() {
        const count = this.readInternal();
        if (count === -1)
            return;
        for (const sample of this.samples) {
            if (!sample.ctx.Result)
                continue;
            sample.ctx.Result =
                sample.ctx.OpReturnReached || sample.tokens.length === count;
        }
        this.finalizeDstas();
    }
    handleToken(token, tokenIdx) {
        let activeDetectors = 0;
        for (const sample of this.samples) {
            if (!sample.ctx.Result)
                continue;
            activeDetectors++;
            if (!sample.ctx.OpReturnReached) {
                if (sample.tokens.length === tokenIdx) {
                    if (token.OpCode === op_codes_1.OpCode.OP_RETURN) {
                        sample.ctx.OpReturnReached = true;
                    }
                }
                else {
                    const expected = sample.tokens[tokenIdx];
                    const nextResult = expected ? this.sameToken(expected, token) : false;
                    sample.ctx.Result = nextResult;
                    if (nextResult) {
                        if (expected.IsReceiverId && token.Data.length > 0) {
                            this.Address = new address_1.Address(token.Data);
                        }
                    }
                }
            }
            else {
                this.addData(token.Data);
            }
        }
        this.handleDstasToken(token);
        if (this.dstasCtx.Result)
            activeDetectors++;
        return activeDetectors > 0;
    }
    sameToken(expected, actual) {
        return (0, identity_field_1.sameBytesOrShape)(expected, actual);
    }
    addData(data) {
        if (!this.Data)
            this.Data = [];
        this.Data.push(data);
    }
    handleDstasToken(token) {
        if (!this.dstasCtx.Result)
            return;
        switch (this.dstasCtx.Stage) {
            case "owner": {
                if (!this.isPushData(token) || !(0, identity_field_1.isSupportedIdentityField)(token.Data)) {
                    this.dstasCtx.Result = false;
                    return;
                }
                this.dstasCtx.Owner = token.Data;
                this.dstasCtx.Stage = "second";
                return;
            }
            case "second": {
                if (this.isPushData(token)) {
                    this.dstasCtx.ActionDataRaw = token.Data;
                }
                else {
                    this.dstasCtx.ActionDataOpCode = token.OpCodeNum;
                }
                this.dstasCtx.Stage = "base";
                return;
            }
            case "base": {
                const expected = this.dstasBaseTokens[this.dstasCtx.BaseIdx];
                if (!expected || !this.sameToken(expected, token)) {
                    this.dstasCtx.Result = false;
                    return;
                }
                this.dstasCtx.BaseIdx++;
                if (this.dstasCtx.BaseIdx === this.dstasBaseTokens.length) {
                    this.dstasCtx.Stage = "redemption";
                }
                return;
            }
            case "redemption": {
                if (!this.isPushData(token) || token.Data.length !== 20) {
                    this.dstasCtx.Result = false;
                    return;
                }
                this.dstasCtx.Redemption = token.Data;
                this.dstasCtx.Stage = "flags";
                return;
            }
            case "flags": {
                if (!this.isPushData(token)) {
                    this.dstasCtx.Result = false;
                    return;
                }
                this.dstasCtx.Flags = token.Data;
                const rightmostByte = token.Data.length > 0 ? token.Data[token.Data.length - 1] : 0;
                this.dstasCtx.FreezeEnabled = (rightmostByte & 0x01) === 0x01;
                this.dstasCtx.ConfiscationEnabled = (rightmostByte & 0x02) === 0x02;
                this.dstasCtx.ExpectedServiceFieldsCount =
                    (this.dstasCtx.FreezeEnabled ? 1 : 0) +
                        (this.dstasCtx.ConfiscationEnabled ? 1 : 0);
                this.dstasCtx.Stage = "tail";
                return;
            }
            case "tail": {
                if (!this.isPushData(token)) {
                    this.dstasCtx.Result = false;
                    return;
                }
                if (this.dstasCtx.ServiceFields.length <
                    this.dstasCtx.ExpectedServiceFieldsCount) {
                    if (!(0, identity_field_1.isSupportedIdentityField)(token.Data)) {
                        this.dstasCtx.Result = false;
                        return;
                    }
                    this.dstasCtx.ServiceFields.push(token.Data);
                }
                else {
                    this.dstasCtx.OptionalData.push(token.Data);
                }
                return;
            }
        }
    }
    finalizeDstas() {
        if (!this.dstasCtx.Result)
            return;
        if (this.dstasCtx.Stage === "owner")
            return;
        if (this.dstasCtx.Stage === "second")
            return;
        if (this.dstasCtx.Stage === "base")
            return;
        if (this.dstasCtx.Stage === "redemption")
            return;
        if (this.dstasCtx.Stage === "flags")
            return;
        if (!this.dstasCtx.Owner ||
            !this.dstasCtx.Redemption ||
            !this.dstasCtx.Flags)
            return;
        if (this.dstasCtx.ServiceFields.length <
            this.dstasCtx.ExpectedServiceFieldsCount)
            return;
        let actionDataParsed;
        if (this.dstasCtx.ActionDataRaw) {
            try {
                actionDataParsed = (0, dstas_action_data_1.decodeActionData)(this.dstasCtx.ActionDataRaw);
            }
            catch (_a) {
                this.dstasCtx.Result = false;
                return;
            }
        }
        this.ScriptTypeOverride = script_type_1.ScriptType.dstas;
        if (this.dstasCtx.Owner.length === 20) {
            this.Address = new address_1.Address(this.dstasCtx.Owner);
        }
        this.Dstas = {
            Owner: this.dstasCtx.Owner,
            ActionDataRaw: this.dstasCtx.ActionDataRaw,
            ActionDataOpCode: this.dstasCtx.ActionDataOpCode,
            ActionDataParsed: actionDataParsed,
            Redemption: this.dstasCtx.Redemption,
            Flags: this.dstasCtx.Flags,
            FreezeEnabled: this.dstasCtx.FreezeEnabled,
            ConfiscationEnabled: this.dstasCtx.ConfiscationEnabled,
            ServiceFields: this.dstasCtx.ServiceFields,
            OptionalData: this.dstasCtx.OptionalData,
        };
        if (this.dstasCtx.Owner.length === 20) {
            this.Address = new address_1.Address(this.dstasCtx.Owner);
        }
    }
    isPushData(token) {
        return (token.OpCodeNum > 0 &&
            (token.OpCodeNum < op_codes_1.OpCode.OP_PUSHDATA1 ||
                token.OpCodeNum === op_codes_1.OpCode.OP_PUSHDATA1 ||
                token.OpCodeNum === op_codes_1.OpCode.OP_PUSHDATA2 ||
                token.OpCodeNum === op_codes_1.OpCode.OP_PUSHDATA4));
    }
    getTokenId() {
        if (this.ScriptType !== script_type_1.ScriptType.p2stas)
            return null;
        if (!this.Data || this.Data.length === 0)
            return null;
        return (0, bytes_1.toHex)(this.Data[0]);
    }
    getSymbol() {
        if (this.ScriptType !== script_type_1.ScriptType.p2stas)
            return null;
        if (!this.Data || this.Data.length < 2)
            return null;
        return (0, bytes_1.bytesToUtf8)(this.Data[1]);
    }
    getData() {
        if (this.ScriptType !== script_type_1.ScriptType.p2stas)
            return new Uint8Array(0);
        if (!this.Data || this.Data.length <= 2)
            return new Uint8Array(0);
        return this.Data[2];
    }
    static readHex(hex) {
        return LockingScriptReader.read((0, bytes_1.fromHex)(hex));
    }
    static read(bytes, expectedLength) {
        const reader = new LockingScriptReader(bytes, expectedLength);
        reader.read();
        return reader;
    }
}
exports.LockingScriptReader = LockingScriptReader;
//# sourceMappingURL=locking-script-reader.js.map