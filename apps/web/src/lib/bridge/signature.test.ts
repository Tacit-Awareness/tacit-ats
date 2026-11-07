import { describe, expect, test } from "vitest";

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, bridgeSecrets, signBridgeRequest, verifyBridgeRequest } from "./signature";

const SECRET = "s".repeat(40);
const NOW = new Date("2026-11-06T12:00:00Z");
const ts = String(NOW.getTime() / 1000);
const headers = (timestamp: string, signature: string) =>
  new Headers({ [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature });

describe("the bridge's signature", () => {
  test("a request signed with the secret over its timestamp and body passes", () => {
    const body = '{"orgId":null}';
    expect(verifyBridgeRequest([SECRET], headers(ts, signBridgeRequest(SECRET, ts, body)), body, NOW)).toBe(true);
  });

  test("another body, another secret, a missing or malformed header fail", () => {
    const sig = signBridgeRequest(SECRET, ts, "{}");
    expect(verifyBridgeRequest([SECRET], headers(ts, sig), '{"x":1}', NOW)).toBe(false);
    expect(verifyBridgeRequest(["t".repeat(40)], headers(ts, sig), "{}", NOW)).toBe(false);
    expect(verifyBridgeRequest([SECRET], new Headers(), "{}", NOW)).toBe(false);
    expect(verifyBridgeRequest([SECRET], headers(ts, sig.toUpperCase()), "{}", NOW)).toBe(false);
    expect(verifyBridgeRequest([SECRET], headers(`${ts}.5`, sig), "{}", NOW)).toBe(false);
  });

  test("a timestamp more than five minutes off is refused, either way", () => {
    for (const offset of [-301, 301]) {
      const t = String(Number(ts) + offset);
      expect(verifyBridgeRequest([SECRET], headers(t, signBridgeRequest(SECRET, t, "{}")), "{}", NOW)).toBe(false);
    }
    const t = String(Number(ts) - 299);
    expect(verifyBridgeRequest([SECRET], headers(t, signBridgeRequest(SECRET, t, "{}")), "{}", NOW)).toBe(true);
  });

  test("while a secret is rotated, either one signs; short ones are not secrets", () => {
    const old = "o".repeat(40);
    const secrets = bridgeSecrets(` ${SECRET} , ${old} ,short`);
    expect(secrets).toEqual([SECRET, old]);
    expect(verifyBridgeRequest(secrets, headers(ts, signBridgeRequest(old, ts, "{}")), "{}", NOW)).toBe(true);
    expect(bridgeSecrets(undefined)).toEqual([]);
  });
});
