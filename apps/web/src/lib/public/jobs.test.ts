import { describe, expect, test } from "vitest";
import { applyOutcome, answersFromForm } from "./jobs";

describe("applyOutcome", () => {
  test("maps the database's answer onto the page's codes, naming a question by id at most", () => {
    expect(applyOutcome(null)).toEqual({ status: "ok" });
    expect(applyOutcome({ code: "P0002", message: "job post not found" })).toEqual({ status: "not_found" });
    expect(applyOutcome({ code: "PT429", message: "too many applications: try again later" })).toEqual({ status: "busy" });
    expect(applyOutcome({ code: "22023", message: "q_why12: required" })).toEqual({ status: "invalid", reason: "required", questionId: "q_why12" });
    expect(applyOutcome({ code: "22023", message: "email: invalid" })).toEqual({ status: "invalid", reason: "invalid", questionId: "email" });
    expect(applyOutcome({ code: "22023", message: "answers: unknown" })).toEqual({ status: "invalid", reason: "invalid", questionId: null });
    expect(applyOutcome({ code: "42501", message: "permission denied" })).toEqual({ status: "failed" });
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
    expect(answersFromForm(form)).toEqual({ answers: { name: "Nia", q_why12: "Hard problems." }, honeypot: "" });
  });
});
