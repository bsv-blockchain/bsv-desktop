import { Bytes } from "../bytes";
import { Network } from "./network";
export declare class Address {
    Value: string;
    Hash160: Bytes;
    Network: Network;
    constructor(hash160: Bytes);
    static fromBase58: (address: string) => Address;
    static fromPublicKey: (publicKey: Bytes) => Address;
    static fromHash160Hex: (hash160: string) => Address;
}
//# sourceMappingURL=address.d.ts.map