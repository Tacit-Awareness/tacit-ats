import { createHash } from "node:crypto";

// The invitation's requestId, which makes it idempotent on Testbench: the
// same ATS application, Testbench role and address always ask for the same
// invitation, so a second "Review draft", a retry or another member gets the
// same link back and no second attempt. A UUID v5 (RFC 4122: SHA-1 of a
// namespace and a name). Pure.

/** This integration's own namespace; changing it would mint new invitations for everyone already invited. */
const NAMESPACE = "6f0f3f0e-8f1b-5c0a-9d57-7a1c3f2b9e41";

const bytes = (uuid: string) => Buffer.from(uuid.replace(/-/g, ""), "hex");

function uuidV5(name: string): string {
  const hash = createHash("sha1").update(bytes(NAMESPACE)).update(name, "utf8").digest().subarray(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function inviteRequestId(input: { applicationId: string; testbenchRoleId: string; email: string }): string {
  return uuidV5(`${input.applicationId.toLowerCase()}:${input.testbenchRoleId.toLowerCase()}:${input.email.trim().toLowerCase()}`);
}
