import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeWalletByteFields,
  parseWalletPayload,
  stringifyWalletPayload,
} from "../src/walletByteJson";

const mangled = (bytes: number[]) =>
  JSON.parse(JSON.stringify(new Uint8Array(bytes)));

describe("wallet byte JSON compatibility", () => {
  it("keeps every standard BRC-100 wallet request and result on the compatibility boundary", () => {
    const source = readFileSync(
      new URL("../src/onWalletReady.ts", import.meta.url),
      "utf8",
    );

    const routesWithArguments = [
      "createAction",
      "signAction",
      "abortAction",
      "listActions",
      "internalizeAction",
      "listOutputs",
      "relinquishOutput",
      "getPublicKey",
      "revealCounterpartyKeyLinkage",
      "revealSpecificKeyLinkage",
      "encrypt",
      "decrypt",
      "createHmac",
      "verifyHmac",
      "createSignature",
      "verifySignature",
      "acquireCertificate",
      "listCertificates",
      "proveCertificate",
      "relinquishCertificate",
      "discoverByIdentityKey",
      "discoverByAttributes",
      "getHeaderForHeight",
    ];
    const routesWithoutArguments = [
      "isAuthenticated",
      "waitForAuthentication",
      "getHeight",
      "getNetwork",
      "getVersion",
    ];

    const routeBlock = (route: string): string => {
      const marker = `case '/${route}': {`;
      const start = source.indexOf(marker);
      expect(start, `missing /${route} route`).toBeGreaterThanOrEqual(0);
      const nextCase = source.indexOf("\n        case '", start + marker.length);
      const nextDefault = source.indexOf("\n        default:", start + marker.length);
      const candidates = [nextCase, nextDefault].filter((index) => index >= 0);
      const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
      return source.slice(start, end);
    };

    for (const route of routesWithArguments) {
      const block = routeBlock(route);
      expect(block, `/${route} request`).toContain("parseWalletPayload(req.body)");
      expect(block, `/${route} result`).toContain("stringifyWalletPayload(result)");
      expect(block, `/${route} request`).not.toContain("JSON.parse(req.body)");
      expect(block, `/${route} result`).not.toContain("JSON.stringify(result)");
    }

    for (const route of routesWithoutArguments) {
      const block = routeBlock(route);
      expect(block, `/${route} result`).toContain("stringifyWalletPayload(result)");
      expect(block, `/${route} result`).not.toContain("JSON.stringify(result)");
    }

    expect(source.match(/stringifyWalletPayload\(e\)/g)).toHaveLength(3);
  });

  it("keeps valid number arrays on the identity fast path", () => {
    const tx = [1, 2, 3];
    const payload = { tx };

    expect(normalizeWalletByteFields(payload)).toBe(payload);
    expect(payload.tx).toBe(tx);
  });

  it("serializes nested typed arrays and subclasses as portable arrays", () => {
    class ForeignBytes extends Uint8Array {}
    const json = stringifyWalletPayload({
      signableTransaction: { tx: new ForeignBytes([1, 2, 3]) },
      encrypted: new Uint8Array([4, 5]),
    });

    expect(JSON.parse(json)).toEqual({
      signableTransaction: { tx: [1, 2, 3] },
      encrypted: [4, 5],
    });
  });

  it("repairs historical numeric-key requests and results recursively", () => {
    const parsed = parseWalletPayload<{
      inputBEEF: number[];
      nested: { transaction: number[] };
    }>(
      JSON.stringify({
        inputBEEF: mangled([1, 2]),
        nested: { transaction: mangled([3, 4]) },
      }),
    );

    expect(parsed).toEqual({
      inputBEEF: [1, 2],
      nested: { transaction: [3, 4] },
    });
    expect(JSON.parse(stringifyWalletPayload({ tx: mangled([5, 6]) }))).toEqual(
      {
        tx: [5, 6],
      },
    );
  });

  it("preserves unrelated numeric records and ambiguous empty containers", () => {
    const unrelated = mangled([9, 8]);
    const payload = {
      unrelated,
      data: {},
      payload: { transaction: mangled([1, 2, 3]) },
    };

    expect(normalizeWalletByteFields(payload)).toEqual({
      unrelated,
      data: {},
      payload: { transaction: [1, 2, 3] },
    });
  });

  it("leaves malformed byte records intact so validation fails instead of truncating", () => {
    const malformed = { 0: 1, 2: 3 };
    const outOfRange = { 0: 256 };
    const payload = { tx: malformed, signature: outOfRange };

    normalizeWalletByteFields(payload);
    expect(payload.tx).toBe(malformed);
    expect(payload.signature).toBe(outOfRange);
  });

  it("does not mistake other binary views for empty byte arrays", () => {
    const view = new DataView(new ArrayBuffer(4));
    const buffer = new ArrayBuffer(4);
    const payload = { tx: view, signature: buffer };

    normalizeWalletByteFields(payload);
    expect(payload.tx).toBe(view);
    expect(payload.signature).toBe(buffer);
  });
});
