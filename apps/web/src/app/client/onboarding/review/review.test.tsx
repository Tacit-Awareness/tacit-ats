import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Coverage } from "@/lib/client/coverage";
import { ReviewStep } from "./view";

const coverage = (over: Partial<Coverage> = {}): Coverage => ({
  interviewers: 2,
  teams: 1,
  multidisciplinary: 0,
  types: 2,
  covered: 2,
  rows: [
    { typeId: "t1", name: "Coding", people: [{ id: "a", name: "Ana Lee", starred: true }, { id: "b", name: "Ben Ito", starred: false }] },
    { typeId: "t2", name: "Design", people: [{ id: "b", name: "Ben Ito", starred: false }] },
  ],
  gaps: [],
  state: "covered",
  ...over,
});
const gaps = coverage({
  covered: 1,
  rows: [{ typeId: "t1", name: "Coding", people: [{ id: "a", name: "Ana Lee", starred: false }] }, { typeId: "t2", name: "Design", people: [] }],
  gaps: ["Design"],
  state: "gaps",
});
const html = (c: Coverage, { ready = true, canEdit = true } = {}) => renderToStaticMarkup(<ReviewStep coverage={c} ready={ready} canEdit={canEdit} truncated={false} />);

describe("Onboarding's Review step", () => {
  test("all covered reads as ready, with the totals and who runs each", () => {
    const page = html(coverage());
    expect(page).toContain("Ready for tATS");
    expect(page).toContain("Every interview type has someone who runs it.");
    expect(page).toContain("2 of 2");
    expect(page).toContain("Multidisciplinary");
    expect(page).toContain("Ana Lee, prioritized");
    expect(page).not.toContain("No one runs this yet");
  });

  test("a gap says no one runs it, and only that: no Inbox, no bots", () => {
    const page = html(gaps);
    expect(page).toContain("No one runs this yet");
    expect(page).toContain("1 interview type has no interviewer.");
    expect(page).toContain("Review your setup");
    expect(page).not.toMatch(/inbox/i);
    expect(page).not.toMatch(/grok/i);
  });

  test("the other steps not done is not ready, however the types look", () => {
    expect(html(coverage(), { ready: false })).not.toContain("Ready for tATS");
  });

  test("no types yet says so and points an admin at the step", () => {
    const page = html(coverage({ state: "no_types", rows: [], types: 0, covered: 0, interviewers: 0 }));
    expect(page).toContain("No interview types yet.");
    expect(page).toContain('href="/client/onboarding/skills"');
    expect(page).not.toContain("Every interview type");
  });

  test("read-only offers no way to fix anything", () => {
    expect(html(gaps, { canEdit: false })).not.toContain("href=");
    const none = html(coverage({ state: "no_types", rows: [], types: 0, covered: 0 }), { canEdit: false });
    expect(none).toContain("An admin adds them");
    expect(none).not.toContain("href=");
  });

  test("on a phone the totals take two columns and a row stacks", () => {
    const page = html(coverage());
    expect(page).toContain("grid-cols-2");
    expect(page).toContain("sm:grid-cols-4");
    expect(page).toContain("sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]");
  });
});
