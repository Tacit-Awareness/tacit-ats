import type { Db } from "@tacit/db";
import { describe, expect, test } from "vitest";
import type { Member } from "./interviews";
import { readAllInterviews } from "./schedule";

// What the local stack cannot be made to do on cue: a row moving between two
// pages of the scan, and the database failing part way through it.

const row = (n: number) => ({
  id: `iv-${n}`, application_id: "app-1", starts_at: "2026-10-30T10:00:00Z", ends_at: "2026-10-30T11:00:00Z", step: null, interviewer_actor_ids: [], location_or_link: null,
});
const page = (first: number, n: number) => Array.from({ length: n }, (_, i) => row(first + i));
const mine = { interview_id: "x", application_id: "app-1", person_id: "p", candidate_name: "Pat", job_id: "job-1", job_title: "Engineer", starts_at: "2026-10-30T10:00:00Z", ends_at: "2026-10-30T11:00:00Z", status: "scheduled", step: null, location_or_link: null, feedback_filed: false };

/** `pages` answers the interviews reads in turn; every other read comes back empty. */
function fakeDb(pages: { data?: unknown[]; error?: { message: string } }[]) {
  const chain = (answer: () => unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "neq", "lt", "gt", "order", "range", "in"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, bad);
    return q;
  };
  return {
    from: (table: string) => chain(() => (table === "interviews" ? { data: null, error: null, ...pages.shift() } : { data: [], error: null })),
    rpc: () => chain(() => ({ data: [mine], error: null })),
  } as unknown as Db;
}

const member: Member = { actorId: "a-1", orgId: "o-1", accessLevel: "limited" };

describe("the Calendar's scan", () => {
  test("an interview booked between two pages does not show the one it pushed along twice", async () => {
    // Newest first: a booking goes on top, so page one's last comes back as page two's first.
    const { items } = await readAllInterviews(fakeDb([{ data: page(0, 1000) }, { data: page(999, 10) }]), member, new Date());
    expect(items).toHaveLength(1009);
    expect(new Set(items.map((i) => i.interviewId)).size).toBe(1009);
  });

  test("a page that fails fails the read, rather than showing part of the calendar as all of it", async () => {
    await expect(readAllInterviews(fakeDb([{ data: page(0, 1000) }, { error: { message: "boom" } }]), member, new Date())).rejects.toThrow("boom");
  });
});
