export type TokenAuthority = {
    m: number;
    publicKeys: string[];
};
export type TokenSchemeOptions = {
    freeze?: boolean;
    confiscation?: boolean;
    isDivisible?: boolean;
    freezeAuthority?: TokenAuthority;
    confiscationAuthority?: TokenAuthority;
};
export declare class TokenScheme {
    Name: string;
    TokenId: string;
    Symbol: string;
    SatoshisPerToken: number;
    Freeze: boolean;
    Confiscation: boolean;
    IsDivisible: boolean;
    FreezeAuthority?: TokenAuthority;
    ConfiscationAuthority?: TokenAuthority;
    constructor(name: string, tokenId: string, symbol: string, satoshisPerToken: number, options?: TokenSchemeOptions);
    toJson: () => string;
    toBytes: () => Uint8Array<ArrayBuffer>;
}
//# sourceMappingURL=token-scheme.d.ts.map