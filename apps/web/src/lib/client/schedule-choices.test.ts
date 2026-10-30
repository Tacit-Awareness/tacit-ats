import type { Db } from "@tacit/db";
import { describe, expect, test } from "vitest";
import { readBookingChoices } from "./schedule-choices";

// The cap by hand, as PostgREST's own: however many a request asks for, at most
// max_rows come back. The rest is schedule-writes.integration.test.ts.

const MAX_ROWS = 1000;
const member = { actorId: "a1", orgId: "o1", accessLevel: "admin" as const };

function dbWith(applications: number) {
  const seen: { limit?: number; filters: Array<[string, unknown]> } = { filters: [] };
  const rows = Array.from({ length: applications }, (_, i) => ({
    id: `app-${i}`, role_id: "job-1", stage: "interviewing", people: { display_name: `Person ${i}` }, roles: { title: "Engineer", status: "open", interview_steps: [] },
  }));
  const apps: Record<string, unknown> = {};
  for (const m of ["select", "in", "is", "order"]) apps[m] = () => apps;
  apps.eq = (column: string, value: unknown) => {
    seen.filters.push([column, value]);
    return apps;
  };
  apps.limit = async (n: number) => {
    seen.limit = n;
    return { data: rows.slice(0, Math.min(n, MAX_ROWS)), error: null };
  };
  const people: Record<string, unknown> = { select: () => people, order: async () => ({ data: [{ id: "a1", display_name: "Ada" }], error: null }) };
  return { seen, db: { from: (table: string) => (table === "applications" ? apps : people), rpc: async () => ({ data: true, error: null }) } as unknown as Db };
}

describe("readBookingChoices past the cap", () => {
  test("says the list is short, within what the database will send", async () => {
    const { db, seen } = dbWith(5000);
    const choices = await readBookingChoices(db, member);
    expect(seen.limit).toBeLessThanOrEqual(MAX_ROWS);
    expect(choices.truncated).toBe(true);
    expect(choices.applications).toHaveLength(seen.limit! - 1);
  });

  test("at the cap and under it, nothing is said", async () => {
    const { db, seen } = dbWith(10);
    expect((await readBookingChoices(db, member)).truncated).toBe(false);
    const atCap = dbWith(seen.limit! - 1);
    expect((await readBookingChoices(atCap.db, member)).truncated).toBe(false);
  });

  test("closed jobs are left out by the query, so they do not use up the cap", async () => {
    const { db, seen } = dbWith(1);
    await readBookingChoices(db, member);
    expect(seen.filters).toContainEqual(["roles.status", "open"]);
  });
});
