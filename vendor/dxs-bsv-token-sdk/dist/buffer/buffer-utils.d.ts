import { OpCode } from "../bitcoin/op-codes";
import { Bytes } from "../bytes";
export declare const OP_INT_BASE = OpCode.OP_RESERVED;
export declare const asMinimalOP: (buffer: Bytes) => number | undefined;
export declare const ensureUInt: (value: number, max: number) => void;
export declare const slice: (buffer: Bytes, offset: number, length: number) => Uint8Array<ArrayBuffer>;
export declare const reverseBytes: (buffer: Bytes) => Bytes;
export declare const cloneBytes: (source: Bytes, targetStart?: number, sourceStart?: number | undefined, sourceEnd?: number | undefined) => Uint8Array<ArrayBuffer>;
export declare const splitBytes: (source: Bytes, splitBy: Bytes) => Bytes[];
export declare const getVarIntLength: (value: number) => number;
export declare const getNumberSize: (data: number) => number;
export declare const getMinimumRequiredByte: (value: number) => number;
export declare const getNumberBytes: (value: number) => Bytes;
export declare const estimateChunkSize: (bufferSize: number) => number;
export declare const getChunkSize: (buffer: Bytes) => number;
//# sourceMappingURL=buffer-utils.d.ts.map