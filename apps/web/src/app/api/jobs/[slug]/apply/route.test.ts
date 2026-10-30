import { beforeEach, describe, expect, test, vi } from "vitest";

const submit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public/jobs", async (original) => ({ ...(await original<typeof import("@/lib/public/jobs")>()), submitApplication: submit }));

import { POST } from "./route";

const SLUG = "a".repeat(24);
const form = () => {
  const body = new FormData();
  body.set("a_name", "Nia");
  return body;
};
const post = (query: string, body: BodyInit | null = form(), headers?: HeadersInit) =>
  POST(new Request(`https://ats.test/api/jobs/${SLUG}/apply${query}`, { method: "POST", body, headers }), { params: Promise.resolve({ slug: SLUG }) });
const channelSent = () => submit.mock.calls[0][4];

beforeEach(() => submit.mockReset().mockResolvedValue({ status: "ok" }));

describe("the channel on apply", () => {
  test("is what the form's action carries", async () => {
    await post("?via=linkedin");
    expect(channelSent()).toBe("linkedin");
  });

  test("a form with none is not recorded, and a wrong one neither, and either still applies", async () => {
    await post("");
    expect(channelSent()).toBeNull();
    submit.mockClear();
    const res = await post("?via=%3Cscript%3E");
    expect(channelSent()).toBeNull();
    expect(res.headers.get("location")).toContain("applied=1");
    expect(res.headers.get("location")).not.toContain("via=");
  });

  test("the way back after an error keeps it, so a second try is still from there", async () => {
    submit.mockResolvedValue({ status: "invalid", reason: "required", questionId: "email" });
    const url = new URL((await post("?via=hackernews")).headers.get("location")!);
    expect(url.searchParams.get("via")).toBe("hackernews");
    expect(url.searchParams.get("error")).toBe("required");
  });

  test("so does a form that could not be read, and one too large to try", async () => {
    expect((await post("?via=other", "not a form", { "content-type": "text/plain" })).headers.get("location")).toContain("via=other");
    expect((await post("?via=linkedin", form(), { "content-length": "999999" })).headers.get("location")).toContain("via=linkedin");
    expect(submit).not.toHaveBeenCalled();
  });

  test("direct needs nothing in the URL", async () => {
    const res = await post("?via=direct");
    expect(channelSent()).toBe("direct");
    expect(res.headers.get("location")).not.toContain("via=");
  });
});
