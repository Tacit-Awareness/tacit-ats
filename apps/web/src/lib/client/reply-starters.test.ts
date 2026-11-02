import { describe, expect, test } from "vitest";
import { replyStarters, TESTBENCH_INVITE_URL } from "./reply-starters";

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
    expect(s.bodies.testbench.endsWith(`The link is below.\n\n${TESTBENCH_INVITE_URL}\n\nAda`)).toBe(true);
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
    expect([s.subject, ...Object.values(s.bodies)].join("\n")).not.toMatch(/\{\{|\}\}/);
  });

  test("a member with no name on file signs off with nothing, not their email address", () => {
    expect(replyStarters({ ...base, sender: "ada@acme.test" }).bodies.blank).toBe("Hi Nia,");
  });

  test("double braces in someone's name can't become a placeholder core refuses", () => {
    const s = replyStarters({ ...base, candidateName: "{{job_title}} Smith", jobTitle: "Eng {{oops}}" });
    expect([s.subject, ...Object.values(s.bodies)].join("\n")).not.toMatch(/\{\{|\}\}/);
  });
});
