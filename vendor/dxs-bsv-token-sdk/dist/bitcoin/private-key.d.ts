import { Address } from "./address";
import { Bytes } from "../bytes";
export { verify } from "@noble/secp256k1";
export declare class PrivateKey {
    private _pk;
    private _disposed;
    Address: Address;
    PublicKey: Bytes;
    constructor(pk: Bytes);
    private assertAlive;
    sign: (message: Bytes) => Bytes;
    verify: (signature: Bytes, message: Bytes) => boolean;
    dispose: () => void;
}
export declare const verifyBitcoinSignedMessage: (message: Bytes, publicKey: Bytes, signature: Bytes) => boolean;
//# sourceMappingURL=private-key.d.ts.map