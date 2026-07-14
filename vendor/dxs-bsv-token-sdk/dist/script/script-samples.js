"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDstasTokens = exports.getP2stasTokens = exports.p2stasSampleHex = exports.p2mpkhTokens = exports.p2phkTokens = exports.nullDataTokens = void 0;
const op_codes_1 = require("../bitcoin/op-codes");
const bytes_1 = require("../bytes");
const script_reader_1 = require("./read/script-reader");
const script_token_1 = require("./script-token");
const dstas_locking_builder_1 = require("./build/dstas-locking-builder");
exports.nullDataTokens = [script_token_1.ScriptToken.forSample(op_codes_1.OpCode.OP_0)];
exports.p2phkTokens = [
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_DUP),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_HASH160),
    script_token_1.ScriptToken.forSample(20, 20, true),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_EQUALVERIFY),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_CHECKSIG),
];
exports.p2mpkhTokens = [
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_DUP),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_HASH160),
    script_token_1.ScriptToken.forSample(20, 20, true),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_EQUALVERIFY),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SIZE),
    script_token_1.ScriptToken.fromBytes(new Uint8Array([0x21])),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_EQUAL),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_IF),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_CHECKSIG),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_ELSE),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_1),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SPLIT),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_1),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SPLIT),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_IFDUP),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_IF),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SWAP),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SPLIT),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_ENDIF),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_1),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SPLIT),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_IFDUP),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_IF),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SWAP),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SPLIT),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_ENDIF),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_1),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SPLIT),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_IFDUP),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_IF),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SWAP),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SPLIT),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_ENDIF),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_1),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SPLIT),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_IFDUP),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_IF),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SWAP),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SPLIT),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_ENDIF),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_1),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SPLIT),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_IFDUP),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_IF),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SWAP),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_SPLIT),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_ENDIF),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_CHECKMULTISIG),
    new script_token_1.ScriptToken(op_codes_1.OpCode.OP_ENDIF),
];
exports.p2stasSampleHex = "76a914001122334455667788990011223344556677889988ac6976aa607f5f7f7c5e7f7c5d7f7c5c7f7c5b7f7c5a7f7c597f7c587f7c577f7c567f7c557f7c547f7c537f7c527f7c517f7c7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7c5f7f7c5e7f7c5d7f7c5c7f7c5b7f7c5a7f7c597f7c587f7c577f7c567f7c557f7c547f7c537f7c527f7c517f7c7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e011f7f7d7e01007e8111414136d08c5ed2bf3ba048afe6dcaebafe01005f80837e01007e7652967b537a7601ff877c0100879b7d648b6752799368537a7d9776547aa06394677768263044022079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f8179802207c607f5f7f7c5e7f7c5d7f7c5c7f7c5b7f7c5a7f7c597f7c587f7c577f7c567f7c557f7c547f7c537f7c527f7c517f7c7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7c5f7f7c5e7f7c5d7f7c5c7f7c5b7f7c5a7f7c597f7c587f7c577f7c567f7c557f7c547f7c537f7c527f7c517f7c7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e01417e7c6421038ff83d8cf12121491609c4939dc11c4aa35503508fe432dc5a5c1905608b92186721023635954789a02e39fb7e54440b6f528d53efd65635ddad7f3c4085f97fdbdc4868ad547f7701207f01207f7701247f517f7801007e02fd00a063546752687f7801007e817f727e7b537f7701147f76020c057f7701147f757b876b7b557a766471567a577a786354807e7e676d68aa880067765158a569765187645294567a5379587a7e7e78637c8c7c53797e577a7e6878637c8c7c53797e577a7e6878637c8c7c53797e577a7e6878637c8c7c53797e577a7e6878637c8c7c53797e577a7e6867567a6876aa587a7d54807e577a597a5a7a786354807e6f7e7eaa727c7e676d6e7eaa7c687b7eaa587a7d877663516752687c72879b69537a6491687c7b547f77517f7853a0916901247f77517f7c01007e817602fc00a06302fd00a063546752687f7c01007e816854937f77788c6301247f77517f7c01007e817602fc00a06302fd00a063546752687f7c01007e816854937f777852946301247f77517f7c01007e817602fc00a06302fd00a063546752687f7c01007e816854937f77686877517f7c52797d8b9f7c53a09b91697c76638c7c587f77517f7c01007e817602fc00a06302fd00a063546752687f7c01007e81687f777c6876638c7c587f77517f7c01007e817602fc00a06302fd00a063546752687f7c01007e81687f777c6863587f77517f7c01007e817602fc00a06302fd00a063546752687f7c01007e81687f7768587f517f7801007e817602fc00a06302fd00a063546752687f7801007e81727e7b7b687f75537f7c0376a9148801147f775379645579887567726881687863547a677b68587f7c815379635379528763547a6b547a6b7b6b67567a6b567a6b6b7c68677b93687c547f7701207f75748c7a7669765880041976a9147858790376a9147e7e748c7a7d7e5879727e0288ac727e547a00587a64745da0637c748c7a76697d937b7b58807e59790376a9147e748c7a7e59797e7e68676c766976748c7a9d58807e6c0376a9147e748c7a7e6c7e7e68745da0637c748c7a76697d937b7b58807e59790376a9147e748c7a7e59797e7e68745da0637c748c7a76697d937b7b58807e59790376a9147e748c7a7e59797e7e687c577a9d7d7e5979635a795880041976a9145b797e0288ac7e7e6700687d7e597a766302006a7c7e827602fc00a06301fd7c7e536751687f757c7e0058807c7e687d7eaa6b7e7e7e7e7eaa78877c6c877c6c9a9b726d7777";
let stasTokens = null;
let dstasTokens = null;
const getP2stasTokens = () => {
    if (stasTokens === null) {
        stasTokens = script_reader_1.ScriptReader.read((0, bytes_1.fromHex)(exports.p2stasSampleHex));
        stasTokens[2] = script_token_1.ScriptToken.forSample(20, 20, true);
    }
    return stasTokens;
};
exports.getP2stasTokens = getP2stasTokens;
const getDstasTokens = () => {
    if (dstasTokens === null) {
        const ownerHex = "1111111111111111111111111111111111111111";
        const redemptionHex = "2222222222222222222222222222222222222222";
        const flagsHex = "00";
        const script = (0, dstas_locking_builder_1.buildDstasLockingScript)({
            ownerPkh: (0, bytes_1.fromHex)(ownerHex),
            actionData: null,
            redemptionPkh: (0, bytes_1.fromHex)(redemptionHex),
            flags: (0, bytes_1.fromHex)(flagsHex),
            serviceFields: [],
            optionalData: [],
        });
        dstasTokens = script_reader_1.ScriptReader.read(script);
        if (dstasTokens.length >= 2) {
            dstasTokens[0].IsReceiverId = true;
            dstasTokens[1].IsActionData = true;
        }
        const redemptionBytes = (0, bytes_1.fromHex)(redemptionHex);
        const flagsBytes = (0, bytes_1.fromHex)(flagsHex);
        for (const token of dstasTokens) {
            if (token.Data && token.Data.length === redemptionBytes.length) {
                let match = true;
                for (let i = 0; i < redemptionBytes.length; i++) {
                    if (token.Data[i] !== redemptionBytes[i]) {
                        match = false;
                        break;
                    }
                }
                if (match)
                    token.IsRedemptionId = true;
            }
            if (token.Data && token.Data.length === flagsBytes.length) {
                let match = true;
                for (let i = 0; i < flagsBytes.length; i++) {
                    if (token.Data[i] !== flagsBytes[i]) {
                        match = false;
                        break;
                    }
                }
                if (match)
                    token.IsFlagsField = true;
            }
        }
    }
    return dstasTokens;
};
exports.getDstasTokens = getDstasTokens;
//# sourceMappingURL=script-samples.js.map