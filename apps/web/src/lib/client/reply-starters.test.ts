import { describe, expect, test } from "vitest";
import { hasTestbenchLink, replyStarters, TESTBENCH_LINK, withTestbenchLink } from "./reply-starters";

/** Every starter's text with the one marker the Testbench starter is meant to carry taken out. */
const texts = (s: ReturnType<typeof replyStarters>) => [s.subject, ...Object.values(s.bodies)].join("\n").replace(TESTBENCH_LINK, "");

const base = { candidateName: "Nia Okafor", jobTitle: "Founding Engineer", company: "Acme", sender: "Ada Admin" };

describe("replyStarters", () => {
  test("addresses them, names the job, and signs with the member's first name", () => {
    const s = replyStarters(base);
    expect(s.subject).toBe("Your application for Founding Engineer");
    expect(s.bodies.interview).toMatch(/^Hi Nia,\n\nThanks for applying for the Founding Engineer role\./);
    expect(s.bodies.interview.endsWith("\n\nAda")).toBe(true);
    expect(s.bodies.decline).toContain("your interest in Acme");
    expect(s.bodies.blank).toBe("Hi Nia,\n\nAda");
    expect(s.bodies.testbench).toMatch(/^Hi Nia,\n\nThanks for applying for the Founding Engineer role\. Before we talk/);
    expect(s.bodies.testbench.endsWith(`The link is below.\n\n${TESTBENCH_LINK}\n\nAda`)).toBe(true);
  });

  test("no name on the application says Hi, not Hi undefined", () => {
    expect(replyStarters({ ...base, candidateName: null }).bodies.blank).toBe("Hi,\n\nAda");
    expect(replyStarters({ ...base, candidateName: "   " }).bodies.blank).toBe("Hi,\n\nAda");
  });

  test("a job with no title reads as a sentence, not \"the this role\"", () => {
    for (const jobTitle of [null, "   ", "{{}}"]) {
      const s = replyStarters({ ...base, jobTitle });
      expect(s.subject).toBe("Your application");
      expect(s.bodies.interview).toContain("Thanks for applying for the role.");
      expect(s.bodies.decline).toContain("Thank you for applying for the role,");
    }
  });

  test("single braces can't be left to close up into a placeholder either", () => {
    const s = replyStarters({ ...base, candidateName: "{}}{oops}{{}", jobTitle: "{}}{job_title}{{}", company: "{}}{x}{{}" });
    expect(texts(s)).not.toMatch(/\{\{|\}\}/);
  });

  test("a member with no name on file signs off with nothing, not their email address", () => {
    expect(replyStarters({ ...base, sender: "ada@acme.test" }).bodies.blank).toBe("Hi Nia,");
  });

  test("double braces in someone's name can't become a placeholder core refuses", () => {
    const s = replyStarters({ ...base, candidateName: "{{job_title}} Smith", jobTitle: "Eng {{oops}}" });
    expect(texts(s)).not.toMatch(/\{\{|\}\}/);
  });

  test("no starter carries a link: the Testbench one holds the marker, once, and no other does", () => {
    const s = replyStarters(base);
    expect(Object.values(s.bodies).join("\n")).not.toMatch(/https?:/);
    expect(s.bodies.testbench.split(TESTBENCH_LINK)).toHaveLength(2);
    for (const kind of ["interview", "decline", "blank"] as const) expect(hasTestbenchLink(s.bodies[kind])).toBe(false);
    expect(hasTestbenchLink(s.subject)).toBe(false);
  });
});

describe("the Testbench link marker", () => {
  test("is found as core reads a placeholder, spaces and all", () => {
    expect(hasTestbenchLink("see {{testbench_link}}")).toBe(true);
    expect(hasTestbenchLink("see {{ testbench_link }}")).toBe(true);
    expect(hasTestbenchLink("see {testbench_link}")).toBe(false);
    expect(hasTestbenchLink("see {{testbench}}")).toBe(false);
  });

  test("every marker becomes the link, as it came", () => {
    const url = "https://testbench.example/invite/a$&b$1";
    expect(withTestbenchLink("one {{testbench_link}} two {{ testbench_link }}", url)).toBe(`one ${url} two ${url}`);
    expect(hasTestbenchLink(withTestbenchLink(replyStarters(base).bodies.testbench, url))).toBe(false);
  });
});
