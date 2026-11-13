import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// The Interviewers table's words: each number with its label, a week against
// the weekly limit only when there is one, every job and skill behind "and N
// more", and red only for a week over the limit and feedback not filed.

vi.mock("./actions", () => ({ saveProfileAction: vi.fn() }));
vi.mock("../onboarding/actions", () => ({ saveTitleAction: vi.fn(), inviteAction: vi.fn(), withdrawAction: vi.fn(), setAccessAction: vi.fn() }));

import type { StoredProfile } from "@/lib/client/interviewer-profile";
import { TeamSections } from "./team";
import { InterviewersView, OwnProfile, type InterviewerViewRow } from "./view";

const profile = (p: Partial<StoredProfile>): StoredProfile => ({
  preference: null,
  weeklyCap: null,
  focusAreas: [],
  channel: null,
  awayUntil: null,
  updatedAt: "2026-11-01T00:00:00Z",
  ...p,
});

const ada: InterviewerViewRow = {
  actorId: "e6a00000-0000-4000-8000-0000000000a1",
  name: "Ada Lovelace",
  thisWeek: 2,
  nextWeek: 0,
  last30: 5,
  feedback: { onTime: 1, late: 1, notFiled: 2, notVisible: 0 },
  jobs: ["Founding Engineer, Infra", "Staff Engineer"],
  profile: profile({ weeklyCap: 4, focusAreas: ["Go, Rust", "System design"], preference: "loves" }),
  away: "Away through Nov 18",
  editable: true,
  self: false,
};

const bo: InterviewerViewRow = {
  actorId: "e6a00000-0000-4000-8000-0000000000b2",
  name: "Bo Chen",
  thisWeek: 0,
  nextWeek: 1,
  last30: 0,
  feedback: null,
  jobs: [],
  profile: null,
  away: null,
  editable: false,
  self: false,
};

const render = (rows: InterviewerViewRow[], feedback = true) =>
  renderToStaticMarkup(<InterviewersView groups={[{ label: "Infra", rows }]} feedback={feedback} note={null} empty={null} />);

describe("InterviewersView", () => {
  test("heads say what each column is, in sentence case", () => {
    const html = render([ada, bo]);
    for (const head of ["Interviewer", "Interviews for", "Skills", "Booked this week", "Next week", "Feedback"]) expect(html).toContain(`>${head}<`);
    expect(html).not.toMatch(/>(Knows|Reach|Interviewing|Last 30 days)</);
  });

  test("a week reads against the limit when there is one, and as interviews or None when not", () => {
    const html = render([ada, bo]);
    expect(html).toContain(">2 of 4<");
    expect(html).toContain(">0 of 4<");
    expect(html).toContain(">None<");
    expect(html).toContain(">1 interview<");
    expect(html).not.toMatch(/>\d+</);
    // One meter, this week's, for the one person with a limit, grey while they are away.
    expect(html.match(/rounded-\[3px\] bg-\[color:var\(--soft-strong\)\]/g)).toHaveLength(1);
    expect(html).toContain("rounded-[3px] bg-[color:var(--ink-4)]");
    expect(html).toContain("Away through Nov 18.");
  });

  test("a week over the limit is red, its meter too", () => {
    const html = render([{ ...ada, thisWeek: 5, away: null, feedback: null }]);
    expect(html).toMatch(/text-negative">5 of 4</);
    expect(html).toContain("rounded-[3px] bg-negative");
  });

  test("the first job and skill show, the rest are counted and listed in the hover title", () => {
    const html = render([ada, bo]);
    expect(html).toContain(`title="Founding Engineer, Infra\nStaff Engineer"`);
    expect(html).toContain(`title="Go, Rust\nSystem design"`);
    expect(html.match(/>and 1 more</g)).toHaveLength(2);
    expect(html).toContain(">No jobs<");
    // A word too wide for its column ends in an ellipsis rather than breaking mid-word.
    expect(html).not.toMatch(/overflow-wrap:(anywhere|break-word)/);
  });

  test("feedback is how much came in on time, with not filed the only red", () => {
    const html = render([ada, bo]);
    expect(html).toContain(">1 of 4 on time<");
    expect(html).toContain(">None due<");
    expect(html.match(/text-negative/g)).toHaveLength(1);
    expect(html).toMatch(/text-negative">2 not filed</);
  });

  test("away is a tag on the name, and Edit is only on a row the member may edit", () => {
    const html = render([ada, bo]);
    expect(html).toContain(">Away through Nov 18<");
    expect(html).toContain(`aria-label="Edit Ada Lovelace&#x27;s interviewer profile"`);
    expect(html).not.toContain("Edit Bo Chen");
    expect(html.match(/ data-row-open="/g)).toHaveLength(2);
  });

  test("without anyone's skills, or the right to read feedback, those columns are left out", () => {
    const html = render([{ ...ada, profile: profile({ weeklyCap: 4 }) }, bo], false);
    expect(html).not.toContain(">Skills<");
    expect(html).not.toContain(">Feedback<");
    expect(html).not.toContain("not filed");
  });
});

describe("OwnProfile", () => {
  test("says what was not said, in the table's words", () => {
    const html = renderToStaticMarkup(<OwnProfile actorId={ada.actorId} name="Ada Lovelace" profile={null} away={null} />);
    for (const label of ["Skills", "Interviewing", "Reach on", "Weekly limit", "Availability"]) expect(html).toContain(`>${label}<`);
    expect(html).toContain(">Not said<");
    expect(html).toContain(">No limit<");
    expect(html).toContain(">Not away<");
  });
});

describe("TeamSections", () => {
  const members = [
    { id: ada.actorId, display_name: "Ada Lovelace", email: "ada@example.com", access_level: "admin" },
    { id: bo.actorId, display_name: "Bo Chen", email: "bo@example.com", access_level: "limited" },
  ];

  test("an external recruiter sees the team, with no count drawn beside a title and no invite form", () => {
    const html = renderToStaticMarkup(<TeamSections members={members} membersTruncated={false} pending={[]} actorId={bo.actorId} isAdmin={false} titles={{}} rendered={0} />);
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain('Members<span class="sr-only">, 2</span>');
    expect(html).not.toContain("Send invitation");
  });

  test("an admin gets the invite form with every access level", () => {
    const html = renderToStaticMarkup(<TeamSections members={members} membersTruncated={false} pending={[]} actorId={ada.actorId} isAdmin titles={{}} rendered={0} />);
    expect(html).toContain("Send invitation");
    for (const level of ["limited", "elevated", "admin"]) expect(html).toContain(`<option value="${level}"`);
    expect(html).toContain("Nobody is waiting on an invitation.");
  });
});
