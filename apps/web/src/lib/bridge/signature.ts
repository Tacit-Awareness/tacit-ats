import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The staff bridge's request signature: tacit-internal signs every call with
 * the secret both projects hold (TACIT_BRIDGE_SECRET), the way a company's
 * bot is signed to (@tacit/core's signAgentWebhook):
 *
 *   x-tacit-bridge-timestamp: <unix seconds>
 *   x-tacit-bridge-signature: v1=<hex HMAC-SHA256 of "<timestamp>.<body>">
 *
 * A timestamp more than five minutes off is refused. Every bridge write is
 * idempotent (a second submission is "already_in_job", a second job for the
 * same role is the same job), so a replay inside the window changes nothing.
 * The secret may be a comma-separated list while it is rotated: any one of
 * them signs.
 */
export const TIMESTAMP_HEADER = "x-tacit-bridge-timestamp";
export const SIGNATURE_HEADER = "x-tacit-bridge-signature";
const TOLERANCE_SECONDS = 5 * 60;

export function bridgeSecrets(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter((s) => s.length >= 32);
}

export function signBridgeRequest(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verifyBridgeRequest(
  secrets: string[],
  headers: Headers,
  body: string,
  now: Date = new Date(),
): boolean {
  const timestamp = headers.get(TIMESTAMP_HEADER) ?? "";
  const signature = headers.get(SIGNATURE_HEADER) ?? "";
  if (!/^\d{1,12}$/.test(timestamp) || !/^v1=[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const given = Buffer.from(signature);
  return secrets.some((secret) => {
    const expected = Buffer.from(signBridgeRequest(secret, timestamp, body));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}
