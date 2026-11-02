import { describe, expect, test } from "vitest";
import { NO_PREFILL, nextRoundHref, parseBook, prefill, withoutBook } from "./next-round-rules";
import type { ApplicationChoice } from "./schedule-choices";

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";

const choice = (over: Partial<ApplicationChoice> = {}): ApplicationChoice => ({
  applicationId: ID,
  candidate: "Ada Lovelace",
  jobTitle: "Engineer",
  stage: "interviewing",
  steps: ["Phone screen", "Onsite", "Founder chat"],
  ...over,
});

describe("Next round's address", () => {
  test("is the Calendar, on the application, and reads back", () => {
    expect(nextRoundHref(ID)).toBe(`/client/schedule?book=${ID}`);
    expect(parseBook(new URL(nextRoundHref(ID), "https://x.test").searchParams.get("book"))).toBe(ID);
  });

  test("anything but an id is nothing", () => {
    for (const raw of [null, undefined, "", "a", `${ID}x`, "../client", `${ID}&step=x`]) expect(parseBook(raw)).toBeNull();
    expect(parseBook(` ${ID.toUpperCase()} `)).toBe(ID);
  });

  test("once open, the address drops it and keeps the rest", () => {
    expect(withoutBook(`?book=${ID}`)).toBe("/client/schedule");
    expect(withoutBook(`?view=week&book=${ID}&dept=Eng%20Ops`)).toBe("/client/schedule?view=week&dept=Eng+Ops");
    expect(withoutBook("")).toBe("/client/schedule");
  });
});

describe("prefill", () => {
  test("nothing asked, nothing picked", () => {
    expect(prefill([choice()], null)).toEqual(NO_PREFILL);
    expect(prefill([choice()], undefined)).toEqual(NO_PREFILL);
  });

  test("picks the candidate and the plan's next step", () => {
    expect(prefill([choice({ applicationId: OTHER }), choice()], { applicationId: ID, step: "Onsite" })).toEqual({ applicationId: ID, step: "Onsite", missing: false });
  });

  test("a step the plan no longer names is left for the member to choose", () => {
    expect(prefill([choice()], { applicationId: ID, step: "Take-home" })).toEqual({ applicationId: ID, step: "", missing: false });
  });

  test("no step left on the plan picks the candidate alone", () => {
    expect(prefill([choice()], { applicationId: ID, step: null })).toEqual({ applicationId: ID, step: "", missing: false });
  });

  test("a job with no plan takes any name", () => {
    expect(prefill([choice({ steps: [] })], { applicationId: ID, step: "Onsite" })).toMatchObject({ step: "Onsite" });
  });

  test("someone the choices don't have is said, not guessed", () => {
    expect(prefill([choice({ applicationId: OTHER })], { applicationId: ID, step: "Onsite" })).toEqual({ applicationId: null, step: "", missing: true });
    expect(prefill([], { applicationId: ID, step: null })).toMatchObject({ missing: true });
  });
});
