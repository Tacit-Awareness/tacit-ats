import { describe, expect, test } from "vitest";
import { inviteRequestId } from "./request-id";

const APP = "22222222-2222-4222-8222-222222222222";
const ROLE = "eeeeeeee-0000-4000-8000-000000000001";
const base = { applicationId: APP, testbenchRoleId: ROLE, email: "nia@example.com" };

describe("inviteRequestId", () => {
  test("is a version 5 uuid, the same every time", () => {
    const id = inviteRequestId(base);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(inviteRequestId({ ...base })).toBe(id);
    // Pinned (and equal to Python's uuid.uuid5 of the same namespace and name): a change here would ask Testbench for a second invitation for everyone already invited.
    expect(id).toBe("96fc4ed7-8dc4-5ec3-b79b-386e746acfab");
  });

  test("the address's case and the ids' case don't make a new invitation", () => {
    const id = inviteRequestId(base);
    expect(inviteRequestId({ ...base, email: "  Nia@Example.COM " })).toBe(id);
    expect(inviteRequestId({ ...base, applicationId: APP.toUpperCase(), testbenchRoleId: ROLE.toUpperCase() })).toBe(id);
  });

  test("another application, role or address is another invitation", () => {
    const ids = new Set([
      inviteRequestId(base),
      inviteRequestId({ ...base, applicationId: "22222222-2222-4222-8222-222222222223" }),
      inviteRequestId({ ...base, testbenchRoleId: "eeeeeeee-0000-4000-8000-000000000002" }),
      inviteRequestId({ ...base, email: "nia@example.org" }),
    ]);
    expect(ids.size).toBe(4);
  });
});
