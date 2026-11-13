import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// What the composer draws before anyone types, to markup: one box, no labelled
// fields, the job chip, the referrer chip for a referral, and an Add that
// waits for a name. Typing, the chips and the post need a browser; the parse
// they show is lib/client/intake-parse.test.ts's.

import { IntakeComposer, type IntakeProps } from "./intake-composer";

const props: IntakeProps = {
  kind: "applicant",
  action: vi.fn(),
  jobs: [
    { jobId: "j1", title: "Founding Engineer, Infra" },
    { jobId: "j2", title: "Product Engineer" },
  ],
  preferJob: "j1",
  me: "Ryan Huang",
  teammates: ["Ryan Huang", "Lena Park"],
  errors: { failed: "That didn't work. Nobody was added." },
  resumeMaxBytes: 3 * 1024 * 1024,
  resumeAccept: ".pdf,.docx",
};
const html = (over: Partial<IntakeProps> = {}) => renderToStaticMarkup(<IntakeComposer {...props} {...over} onClose={() => {}} />);

describe("the intake composer", () => {
  test("one box to write in and a place for a resume, not a form of fields", () => {
    const out = html();
    expect(out).toContain(">Add applicant</h2>");
    expect(out.match(/<textarea/g)).toHaveLength(1);
    expect(out).not.toMatch(/<input(?![^>]*type="file")/);
    expect(out).not.toContain("<select");
    expect(out).toContain("Drop a resume, or choose one");
    expect(out).toMatch(/type="file"[^>]*accept=".pdf,.docx"|accept=".pdf,.docx"[^>]*type="file"/);
  });

  test("starts on the job in view, as a chip that opens a menu", () => {
    const out = html();
    expect(out).toMatch(/aria-haspopup="menu"[^>]*>.*Founding Engineer, Infra/);
  });

  test("with no job in view and several to pick from, the chip asks for one", () => {
    expect(html({ preferJob: null })).toContain("Pick a job");
  });

  test("Add waits for a name, its key inside it", () => {
    const out = html();
    expect(out).toMatch(/type="submit" disabled="" aria-keyshortcuts="Meta\+Enter">Add<kbd/);
    expect(out).toContain('title="Write their name to add them"');
  });

  test("a referral is the member's, until the text or the chip says otherwise", () => {
    const out = html({ kind: "referral", preferJob: null });
    expect(out).toContain(">Add referral</h2>");
    expect(out).toContain("Referred by</span>");
    expect(out).toContain("Ryan Huang");
  });

  test("no job to add people to says so, and offers nothing else", () => {
    const out = html({ jobs: [] });
    expect(out).toContain("There&#x27;s no open job you can add people to.");
    expect(out).not.toContain("<textarea");
    expect(out).not.toContain('type="submit"');
  });

  test("never mentions who else could do this", () => {
    expect(html()).not.toMatch(/claude|grok|slack|bot/i);
    expect(html({ kind: "referral" })).not.toMatch(/claude|grok|slack|bot/i);
  });
});
