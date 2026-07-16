export type Bytes = Uint8Array;
export declare const concat: (chunks: Bytes[]) => Bytes;
export declare const equal: (a: Bytes, b: Bytes) => boolean;
export declare const utf8ToBytes: (value: string) => Bytes;
export declare const bytesToUtf8: (value: Bytes) => string;
export declare const fromHex: (value: string) => Bytes;
export declare const toHex: (value: Bytes) => string;
//# sourceMappingURL=bytes.d.ts.map