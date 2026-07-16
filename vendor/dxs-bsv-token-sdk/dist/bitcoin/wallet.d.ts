import { HDKey, Versions } from "@scure/bip32";
interface WalletOpt {
    versions: Versions;
    depth?: number;
    index?: number;
    parentFingerprint?: number;
    chainCode: Uint8Array;
    privateKey?: Uint8Array;
}
export declare class Wallet extends HDKey {
    static fromMnemonic: (mnemonic: string) => Wallet;
    static fromHdKey: ({ versions, depth, index, parentFingerprint, chainCode, privateKey, }: HDKey) => Wallet;
    private _pk;
    constructor(opt: WalletOpt);
    get Address(): import("./address").Address;
    get PublicKey(): import("../bytes").Bytes;
    deriveWallet: (path: string) => Wallet;
    sign: (message: Uint8Array) => import("../bytes").Bytes;
    signMessage: (message: Uint8Array) => import("../bytes").Bytes;
}
export {};
//# sourceMappingURL=wallet.d.ts.map