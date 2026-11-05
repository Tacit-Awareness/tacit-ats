import { beforeEach, describe, expect, test, vi } from "vitest";

const submit = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public/jobs", async (original) => ({ ...(await original<typeof import("@/lib/public/jobs")>()), submitApplication: submit }));
vi.mock("@/lib/applicant-resume/store", () => ({ storeApplicantResume: store }));

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

beforeEach(() => {
  submit.mockReset().mockResolvedValue({ status: "ok" });
  store.mockReset().mockResolvedValue(true);
});

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
    expect((await post("?via=linkedin", form(), { "content-length": "99999999" })).headers.get("location")).toContain("via=linkedin");
    expect(submit).not.toHaveBeenCalled();
  });

  test("direct needs nothing in the URL", async () => {
    const res = await post("?via=direct");
    expect(channelSent()).toBe("direct");
    expect(res.headers.get("location")).not.toContain("via=");
  });
});

describe("the resume on apply", () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const PATH = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333";
  const withFile = (file: File) => {
    const body = form();
    body.set("a_resume", file);
    return body;
  };
  const where = async (res: Promise<Response>) => new URL((await res).headers.get("location")!);

  test("a file's details go with the answers, and its bytes to the path the database answered", async () => {
    submit.mockResolvedValue({ status: "ok", resumePath: PATH });
    const url = await where(post("", withFile(new File([PDF], "Nia CV.pdf", { type: "application/pdf" }))));
    expect(submit.mock.calls[0][5]).toEqual({ filename: "Nia CV.pdf", contentType: "application/pdf", sizeBytes: PDF.byteLength });
    expect(submit.mock.calls[0][1]).toEqual({ name: "Nia" });
    expect(store).toHaveBeenCalledWith(PATH, PDF, "application/pdf");
    expect(url.searchParams.get("applied")).toBe("1");
    expect(url.searchParams.has("resume")).toBe(false);
  });

  test("no path means nothing to store: someone already in the job, or a honeypot", async () => {
    submit.mockResolvedValue({ status: "ok", resumePath: null });
    expect((await where(post("", withFile(new File([PDF], "cv.pdf"))))).searchParams.get("applied")).toBe("1");
    expect(store).not.toHaveBeenCalled();
  });

  test("a store that fails still applies, and the page says the resume did not upload, never the name", async () => {
    submit.mockResolvedValue({ status: "ok", resumePath: PATH });
    store.mockResolvedValue(false);
    const url = await where(post("", withFile(new File([PDF], "Secret Name.pdf"))));
    expect(url.searchParams.get("resume")).toBe("not_saved");
    expect(url.toString()).not.toContain("Secret");
  });

  test("a file core would refuse is answered before anything is sent", async () => {
    const url = await where(post("", withFile(new File(["<html>"], "cv.pdf"))));
    expect(url.searchParams.get("error")).toBe("resume_invalid");
    expect(submit).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
  });

  test("past 3 MB, by the header or the file, is too big", async () => {
    expect((await where(post("", withFile(new File([new Uint8Array(3 * 1024 * 1024 + 1)], "big.pdf"))))).searchParams.get("error")).toBe("resume_too_big");
    expect((await where(post("", form(), { "content-length": "99999999" }))).searchParams.get("error")).toBe("resume_too_big");
    expect(submit).not.toHaveBeenCalled();
  });

  test("no file picked sends none", async () => {
    await post("", withFile(new File([], "")));
    expect(submit.mock.calls[0][5]).toBeNull();
  });
});
