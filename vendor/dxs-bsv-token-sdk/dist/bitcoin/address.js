"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Address = void 0;
const base_1 = require("../base");
const bytes_1 = require("../bytes");
const hashes_1 = require("../hashes");
const network_1 = require("./network");
class Address {
    constructor(hash160) {
        this.Network = network_1.Networks.Mainnet;
        if (hash160.length !== 20)
            throw new Error("Invalid hash160");
        const buffer = new Uint8Array(21);
        buffer[0] = this.Network.pubKeyHash;
        buffer.set(hash160, 1);
        this.Value = base_1.bs58check.encode(buffer);
        this.Hash160 = hash160;
    }
}
exports.Address = Address;
Address.fromBase58 = (address) => {
    const buffer = base_1.bs58check.decode(address);
    if (buffer[0] !== network_1.Networks.Mainnet.pubKeyHash)
        throw new Error("Only mainnet supported");
    const hash160 = buffer.subarray(1);
    return new Address(hash160);
};
Address.fromPublicKey = (publicKey) => new Address((0, hashes_1.hash160)(publicKey));
Address.fromHash160Hex = (hash160) => new Address((0, bytes_1.fromHex)(hash160));
//# sourceMappingURL=address.js.map