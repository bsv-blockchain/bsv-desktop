const webCrypto = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;

export default webCrypto ?? {};
export const crypto = webCrypto;
