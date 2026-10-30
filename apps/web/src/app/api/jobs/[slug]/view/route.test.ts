import { beforeEach, describe, expect, test, vi } from "vitest";

const jobs = vi.hoisted(() => ({ recordJobPostView: vi.fn() }));
vi.mock("@/lib/public/jobs", () => jobs);

import { POST } from "./route";

const SLUG = "a".repeat(24);
const call = (slug: string, init?: RequestInit) => POST(new Request(`https://ats.test/api/jobs/${slug}/view`, { method: "POST", ...init }), { params: Promise.resolve({ slug }) });

beforeEach(() => jobs.recordJobPostView.mockReset().mockResolvedValue(undefined));

describe("the view beacon", () => {
  test("counts the post and answers with nothing", async () => {
    const res = await call(SLUG);
    expect(jobs.recordJobPostView).toHaveBeenCalledWith(SLUG);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  test("a slug that does not exist gets the same empty answer, so it probes nothing", async () => {
    const res = await call("not-a-slug");
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("takes the slug and nothing about the caller", async () => {
    await call(SLUG, { headers: { referer: "https://www.linkedin.com/in/someone", "user-agent": "x", cookie: "wos-session=abc" }, body: "anything" });
    expect(jobs.recordJobPostView.mock.calls).toEqual([[SLUG]]);
  });
});
