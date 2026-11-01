import { beforeEach, describe, expect, test, vi } from "vitest";

const { getSupabaseServiceClient } = vi.hoisted(() => ({ getSupabaseServiceClient: vi.fn() }));
vi.mock("@tacit/db", () => ({ getSupabaseServiceClient }));

import { memberCalendar } from "./grants";

const ENV = { CLIENT_GOOGLE_CLIENT_ID: "cid", CLIENT_GOOGLE_CLIENT_SECRET: "secret", SUPABASE_URL: "http://db", SUPABASE_SECRET_KEY: "sb_secret" };

/** Records the filters the service client was given. */
const service = (rows: unknown[], error: { message: string } | null = null) => {
  const filters: [string, string, unknown][] = [];
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (c: string, v: unknown) => (filters.push(["eq", c, v]), q);
  q.in = (c: string, v: unknown) => (filters.push(["in", c, v]), { data: rows, error });
  getSupabaseServiceClient.mockReturnValue({ from: () => q });
  return filters;
};

beforeEach(() => vi.clearAllMocks());

describe("memberCalendar", () => {
  test.each([
    ["no Google app", { ...ENV, CLIENT_GOOGLE_CLIENT_ID: undefined }],
    ["no Google secret", { ...ENV, CLIENT_GOOGLE_CLIENT_SECRET: " " }],
    ["no service key", { ...ENV, SUPABASE_SECRET_KEY: undefined }],
    ["no database url", { ...ENV, SUPABASE_URL: "" }],
  ])("%s: null, so nothing reaches for a grant", (_, env) => {
    expect(memberCalendar("https://ats.test", env)).toBeNull();
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
  });

  test("hands core a function, and builds no client until it is called", () => {
    const calendar = memberCalendar("https://ats.test", ENV)!;
    expect(calendar).toMatchObject({ google: { clientId: "cid", clientSecret: "secret" }, connectUrl: "https://ats.test/client/settings" });
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
  });

  test("reads only the Google grants of the members asked for, in the org it is told", async () => {
    const filters = service([{ actor_id: "a", account_email: "a@x.test", refresh_token: "rt-a" }]);
    const found = await memberCalendar("https://ats.test", ENV)!.connections("org-1", ["a", "a", "b"]);
    expect(filters).toEqual([["eq", "org_id", "org-1"], ["eq", "provider", "google"], ["in", "actor_id", ["a", "b"]]]);
    expect(found).toEqual(new Map([["a", { accountEmail: "a@x.test", refreshToken: "rt-a" }]]));
  });

  test("nobody asked for: no read at all", async () => {
    expect(await memberCalendar("https://ats.test", ENV)!.connections("org-1", [])).toEqual(new Map());
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
  });

  test("a failed read throws, rather than reading as nobody connected", async () => {
    service([], { message: "boom" });
    await expect(memberCalendar("https://ats.test", ENV)!.connections("org-1", ["a"])).rejects.toThrow("calendar_connections: boom");
  });
});
