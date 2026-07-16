export { wordlist } from "@scure/bip39/wordlists/english.js";
export type TWords = {
    [idxs: string]: string;
};
export declare class Mnemonic {
    phrase: string;
    words: TWords;
    constructor(phrase: string, words: TWords);
    static generate: () => Mnemonic;
    private static sanitize;
    static fromWords: (words: TWords) => Mnemonic;
    static fromPhrase: (phrase: string) => Mnemonic;
    static fromRandomText: (text: string) => Mnemonic | undefined;
}
//# sourceMappingURL=mnemonic.d.ts.map