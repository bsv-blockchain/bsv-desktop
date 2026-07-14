"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mnemonic = exports.wordlist = void 0;
const bip39_1 = require("@scure/bip39");
const english_js_1 = require("@scure/bip39/wordlists/english.js");
var english_js_2 = require("@scure/bip39/wordlists/english.js");
Object.defineProperty(exports, "wordlist", { enumerable: true, get: function () { return english_js_2.wordlist; } });
class Mnemonic {
    constructor(phrase, words) {
        this.phrase = phrase;
        this.words = words;
    }
}
exports.Mnemonic = Mnemonic;
Mnemonic.generate = () => Mnemonic.fromPhrase((0, bip39_1.generateMnemonic)(english_js_1.wordlist, 128));
Mnemonic.sanitize = (value) => value
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
Mnemonic.fromWords = (words) => {
    const orderedWords = Object.entries(words)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, word]) => word);
    const phrase = Mnemonic.sanitize(orderedWords.join(" "));
    return Mnemonic.fromPhrase(phrase);
};
Mnemonic.fromPhrase = (phrase) => {
    const sanitized = Mnemonic.sanitize(phrase);
    const words = sanitized.split(" ").reduce((a, v, i) => {
        a[`${i}`] = v;
        return a;
    }, {});
    return new Mnemonic(sanitized, words);
};
Mnemonic.fromRandomText = (text) => {
    const sanitized = Mnemonic.sanitize(text);
    if (!sanitized)
        return undefined;
    try {
        if ((0, bip39_1.validateMnemonic)(sanitized, english_js_1.wordlist))
            return Mnemonic.fromPhrase(sanitized);
    }
    catch (_a) {
        return undefined;
    }
};
//# sourceMappingURL=mnemonic.js.map