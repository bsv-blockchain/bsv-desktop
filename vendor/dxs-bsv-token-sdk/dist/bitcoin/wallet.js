"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Wallet = void 0;
const bip39_1 = require("@scure/bip39");
const bip32_1 = require("@scure/bip32");
const private_key_1 = require("./private-key");
class Wallet extends bip32_1.HDKey {
    constructor(opt) {
        super(opt);
        this.deriveWallet = (path) => {
            return Wallet.fromHdKey(super.derive(path));
        };
        this.sign = (message) => this._pk.sign(message);
        this.signMessage = (message) => this._pk.sign(message);
        this._pk = new private_key_1.PrivateKey(this.privateKey);
    }
    get Address() {
        return this._pk.Address;
    }
    get PublicKey() {
        return this._pk.PublicKey;
    }
}
exports.Wallet = Wallet;
Wallet.fromMnemonic = (mnemonic) => {
    let seed;
    try {
        seed = (0, bip39_1.mnemonicToSeedSync)(mnemonic.trim());
    }
    catch (_a) {
        throw new Error("Invalid mnemonic phrase");
    }
    return Wallet.fromHdKey(Wallet.fromMasterSeed(seed));
};
Wallet.fromHdKey = ({ versions, depth, index, parentFingerprint, chainCode, privateKey, }) => new Wallet({
    versions,
    depth,
    index,
    parentFingerprint,
    chainCode: chainCode,
    privateKey: privateKey,
});
//# sourceMappingURL=wallet.js.map