import { Bytes } from "../bytes";
export declare const isCanonicalMpkhField: (value: Bytes) => boolean;
export declare const isSupportedIdentityField: (value: Bytes) => boolean;
export declare const assertSupportedIdentityField: (value: Bytes, name: string) => void;
export declare const sameBytesOrShape: (expected: {
    OpCodeNum: number;
    DataLength: number;
    Data?: Bytes;
}, actual: {
    OpCodeNum: number;
    Data: Bytes;
}) => boolean;
//# sourceMappingURL=identity-field.d.ts.map