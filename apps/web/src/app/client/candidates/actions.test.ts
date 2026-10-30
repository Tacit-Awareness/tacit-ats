import { beforeEach, describe, expect, test, vi } from "vitest";

const { requireClient, bulkReject, bulkTag, bulkAddToPool, revalidatePath } = vi.hoisted(() => ({
  requireClient: vi.fn(),
  bulkReject: vi.fn(),
  bulkTag: vi.fn(),
  bulkAddToPool: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/client/session", () => ({ requireClient }));
vi.mock("@/lib/client/crm-bulk", () => ({ bulkReject, bulkTag, bulkAddToPool }));

import { bulkAddToPoolAction, bulkRejectAction, bulkTagAction } from "./actions";

// An action is callable by id from any page, whatever the page shows, so these
// call them as a tampered client would.

const ID = "00000000-0000-4000-8000-000000000001";
const reject = { applications: [{ applicationId: ID, expectedStage: "screening" }], reasonId: ID, note: null };
const name = { candidateIds: [ID], name: "Silver" };
const member = (accessLevel: string) => ({ db: {}, actorId: ID, accessLevel, org: { id: ID } });
const writes = () => [bulkReject, bulkTag, bulkAddToPool].flatMap((w) => w.mock.calls);

beforeEach(() => {
  vi.clearAllMocks();
  bulkReject.mockResolvedValue({ ok: true, rows: [{ id: ID, outcome: "done" }] });
  bulkTag.mockResolvedValue({ ok: true, rows: [{ id: ID, outcome: "unchanged" }] });
  bulkAddToPool.mockResolvedValue({ ok: false, error: "bad_name" });
});

describe("the bulk actions", () => {
  test("signed out, each stops at requireClient and writes nothing", async () => {
    requireClient.mockRejectedValue(new Error("not signed in"));
    await expect(bulkRejectAction(reject)).rejects.toThrow("not signed in");
    await expect(bulkTagAction(name)).rejects.toThrow("not signed in");
    await expect(bulkAddToPoolAction(name)).rejects.toThrow("not signed in");
    expect(writes()).toEqual([]);
  });

  test("an interviewer is refused by every one, whatever they post", async () => {
    requireClient.mockResolvedValue(member("limited"));
    expect(await bulkRejectAction(reject)).toEqual({ ok: false, error: "forbidden" });
    expect(await bulkTagAction(name)).toEqual({ ok: false, error: "forbidden" });
    expect(await bulkAddToPoolAction(name)).toEqual({ ok: false, error: "forbidden" });
    expect(writes()).toEqual([]);
  });

  test("a tampered post is refused before anything runs", async () => {
    requireClient.mockResolvedValue(member("admin"));
    expect(await bulkRejectAction({ ...reject, applications: [{ applicationId: ID, expectedStage: "offer" }] })).toEqual({ ok: false, error: "invalid" });
    expect(await bulkTagAction({ candidateIds: ID, name: "x" })).toEqual({ ok: false, error: "invalid" });
    expect(await bulkAddToPoolAction(null)).toEqual({ ok: false, error: "invalid" });
    expect(writes()).toEqual([]);
  });

  test("the page refreshes only when a row went through", async () => {
    requireClient.mockResolvedValue(member("elevated"));
    await bulkRejectAction(reject);
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    await bulkTagAction(name);
    await bulkAddToPoolAction(name);
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  test("a failure comes back as a code, never the database's words", async () => {
    requireClient.mockResolvedValue(member("admin"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    bulkReject.mockRejectedValue(new Error("relation offers: private detail"));
    expect(await bulkRejectAction(reject)).toEqual({ ok: false, error: "failed" });
    quiet.mockRestore();
  });
});
