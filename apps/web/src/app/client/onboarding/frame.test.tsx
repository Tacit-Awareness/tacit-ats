import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { path } = vi.hoisted(() => ({ path: { now: "/client/onboarding/people" } }));
vi.mock("next/navigation", () => ({ usePathname: () => path.now }));

import { setupChecklist, type SetupFacts } from "@/lib/client/setup-checklist";
import { OnboardingFrame, OnboardingPointer } from "./frame";

const FACTS: SetupFacts = { people: ["a"], teams: [], types: [], process: null };
const ALL: SetupFacts = { people: ["a", "b"], teams: [{ members: ["a", "b"] }], types: [{ interviewers: ["a", "b"] }], process: { steps: 1, interviews: 1 } };

const frame = (access: "edit" | "read" = "edit", facts = FACTS) =>
  renderToStaticMarkup(
    <OnboardingFrame org="Acme" access={access} checklist={setupChecklist(facts)}>
      <p>the step</p>
    </OnboardingFrame>,
  );

beforeEach(() => {
  path.now = "/client/onboarding/people";
});

describe("the frame", () => {
  test("sets the step in the five, and the checklist counts what is done", () => {
    const html = frame();
    expect(html).toContain("Step 1 of 5");
    expect(html).toContain("Set up Acme&#x27;s hiring team");
    expect(html).toContain("Setup checklist");
    expect(html).toContain("0/5");
    expect(html).toContain("Just you so far");
  });

  test("the checklist comes first in the markup, so it stacks above the step on a phone, and moves beside it after", () => {
    const html = frame();
    expect(html.indexOf("Setup checklist")).toBeLessThan(html.indexOf("the step"));
    expect(html).toContain("lg:order-last");
  });

  test("the first step has no Back, a later one does, and the last opens tATS", () => {
    expect(frame()).not.toMatch(/>Back</);
    path.now = "/client/onboarding/teams";
    expect(frame()).toMatch(/href="\/client\/onboarding\/people"[^>]*>Back</);
    path.now = "/client/onboarding/review";
    expect(frame()).toMatch(/href="\/client"[^>]*>Open tATS</);
  });

  test("the way out goes Home, because nothing has to be finished", () => {
    expect(frame()).toMatch(/href="\/client"[^>]*>Skip for now</);
    expect(frame("edit", ALL)).toMatch(/href="\/client"[^>]*>Back to tATS</);
  });

  test("done, it stops counting steps and reads as the team's page", () => {
    const html = frame("edit", ALL);
    expect(html).toContain("Your hiring team");
    expect(html).not.toContain("Step 1 of 5");
    expect(html).toContain("5/5");
  });

  test("a reader is told so, and an editor is not", () => {
    expect(frame("read")).toContain("Only an admin at your company can change it");
    expect(frame("edit")).not.toContain("Only an admin");
  });

  test("names no Grokbot", () => {
    expect(frame("edit", ALL) + frame()).not.toMatch(/grok/i);
  });
});

describe("the pointer", () => {
  test("sends an interviewer home, under what their last action said", () => {
    const html = renderToStaticMarkup(
      <OnboardingPointer interviewer>
        <p>Access changed.</p>
      </OnboardingPointer>,
    );
    expect(html).toContain("You&#x27;re an interviewer here");
    expect(html.indexOf("Access changed.")).toBeLessThan(html.indexOf("home page"));
    expect(html).not.toContain("Setup checklist");
  });

  test("says something true to an external recruiter, who is not an interviewer", () => {
    const html = renderToStaticMarkup(<OnboardingPointer interviewer={false}>{null}</OnboardingPointer>);
    expect(html).not.toContain("interviewer here");
    expect(html).toContain("home page");
  });
});
