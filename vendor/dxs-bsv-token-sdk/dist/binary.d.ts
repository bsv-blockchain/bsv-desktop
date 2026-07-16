import { Bytes } from "./bytes";
export declare class ByteReader {
    buffer: Bytes;
    view: DataView;
    offset: number;
    constructor(buffer: Bytes, offset?: number);
    readUInt8(): number;
    readUInt16(): number;
    readInt32(): number;
    readUInt32(): number;
    readUInt64(): number;
    readVarInt(): number;
    readChunk(n: number): Uint8Array<ArrayBuffer>;
    readVarChunk(): Uint8Array<ArrayBuffer>;
}
export declare class ByteWriter {
    buffer: Bytes;
    view: DataView;
    offset: number;
    constructor(buffer: Bytes, offset?: number);
    static fromSize: (size: number) => ByteWriter;
    writeUInt8(value: number): void;
    writeUInt16(value: number): void;
    writeUInt32(value: number): void;
    writeUInt64(value: number): void;
    writeVarInt(value: number): void;
    writeChunk(chunk: Bytes): void;
    writeVarChunk(chunk: Bytes): void;
}
//# sourceMappingURL=binary.d.ts.map