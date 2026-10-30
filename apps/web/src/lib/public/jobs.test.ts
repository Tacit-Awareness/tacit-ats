import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@tacit/db", () => ({ createUserClient: () => ({ rpc }) }));

import { applyOutcome, answersFromForm, recordJobPostView, submitApplication } from "./jobs";

const SLUG = "a".repeat(24);

describe("applyOutcome", () => {
  test("maps the database's answer onto the page's codes, naming a question by id at most", () => {
    expect(applyOutcome(null)).toEqual({ status: "ok" });
    expect(applyOutcome({ code: "P0002", message: "job post not found" })).toEqual({ status: "not_found" });
    expect(applyOutcome({ code: "PT429", message: "too many applications: try again later" })).toEqual({ status: "busy" });
    expect(applyOutcome({ code: "22023", message: "q_why12: required" })).toEqual({ status: "invalid", reason: "required", questionId: "q_why12" });
    expect(applyOutcome({ code: "22023", message: "email: invalid" })).toEqual({ status: "invalid", reason: "invalid", questionId: "email" });
    expect(applyOutcome({ code: "22023", message: "answers: unknown" })).toEqual({ status: "invalid", reason: "invalid", questionId: null });
    expect(applyOutcome({ code: "42501", message: "permission denied" })).toEqual({ status: "failed" });
    expect(applyOutcome({ code: "22023", message: "eeoc: invalid" })).toEqual({ status: "invalid", reason: "invalid", questionId: null });
  });
});

describe("answersFromForm", () => {
  test("keeps only the a_ fields as answers, and the honeypot apart", () => {
    const form = new FormData();
    form.set("a_name", "Nia");
    form.set("a_q_why12", "Hard problems.");
    form.set("website", "");
    form.set("other", "ignored");
    form.set("a_resume", new Blob(["x"]));
    expect(answersFromForm(form)).toEqual({ answers: { name: "Nia", q_why12: "Hard problems." }, honeypot: "", eeoc: {} });
  });

  test("keeps the voluntary EEO answers apart from the post's questions, and only the four known fields", () => {
    const form = new FormData();
    form.set("a_name", "Nia");
    form.set("eeoc_gender", "female");
    form.set("eeoc_race_ethnicity", "decline_to_self_identify");
    form.set("eeoc_veteran_status", "");
    form.set("eeoc_shoe_size", "9");
    expect(answersFromForm(form)).toEqual({
      answers: { name: "Nia" }, honeypot: "", eeoc: { gender: "female", race_ethnicity: "decline_to_self_identify" },
    });
  });
});

describe("submitApplication", () => {
  beforeEach(() => rpc.mockReset().mockResolvedValue({ error: null }));

  test("a channel goes to the five-argument form, with all five", async () => {
    await submitApplication(SLUG, { name: "Nia" }, "", {}, "linkedin");
    expect(rpc).toHaveBeenCalledWith("submit_job_application", { p_slug: SLUG, p_answers: { name: "Nia" }, p_honeypot: "", p_eeoc: {}, p_channel: "linkedin" });
  });

  test("no channel stays the four-argument call, which cannot be ambiguous", async () => {
    await submitApplication(SLUG, { name: "Nia" }, "", { gender: "female" });
    expect(rpc).toHaveBeenCalledWith("submit_job_application", { p_slug: SLUG, p_answers: { name: "Nia" }, p_honeypot: "", p_eeoc: { gender: "female" } });
    rpc.mockClear();
    await submitApplication(SLUG, {}, "", {}, null);
    expect(rpc.mock.calls[0][1]).toEqual({ p_slug: SLUG, p_answers: {}, p_honeypot: "" });
  });
});

describe("recordJobPostView", () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("counts on the one function, with the slug and nothing else", async () => {
    await recordJobPostView(SLUG);
    expect(rpc).toHaveBeenCalledWith("record_job_post_view", { p_slug: SLUG });
  });

  test("a slug that cannot be one never reaches the database", async () => {
    await recordJobPostView("../etc/passwd");
    expect(rpc).not.toHaveBeenCalled();
  });

  test("never throws, whatever the database does", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "42501", message: "permission denied" } });
    await expect(recordJobPostView(SLUG)).resolves.toBeUndefined();
    rpc.mockRejectedValueOnce(new Error("fetch failed"));
    await expect(recordJobPostView(SLUG)).resolves.toBeUndefined();
  });
});
