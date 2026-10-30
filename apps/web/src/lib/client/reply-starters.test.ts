import { describe, expect, test } from "vitest";
import { replyStarters } from "./reply-starters";

const base = { candidateName: "Nia Okafor", jobTitle: "Founding Engineer", company: "Acme", sender: "Ada Admin" };

describe("replyStarters", () => {
  test("addresses them, names the job, and signs with the member's first name", () => {
    const s = replyStarters(base);
    expect(s.subject).toBe("Your application for Founding Engineer");
    expect(s.bodies.interview).toMatch(/^Hi Nia,\n\nThanks for applying for the Founding Engineer role\./);
    expect(s.bodies.interview.endsWith("\n\nAda")).toBe(true);
    expect(s.bodies.decline).toContain("your interest in Acme");
    expect(s.bodies.blank).toBe("Hi Nia,\n\nAda");
  });

  test("no name on the application says Hi, not Hi undefined", () => {
    expect(replyStarters({ ...base, candidateName: null }).bodies.blank).toBe("Hi,\n\nAda");
    expect(replyStarters({ ...base, candidateName: "   " }).bodies.blank).toBe("Hi,\n\nAda");
  });

  test("double braces in someone's name can't become a placeholder core refuses", () => {
    const s = replyStarters({ ...base, candidateName: "{{job_title}} Smith", jobTitle: "Eng {{oops}}" });
    expect([s.subject, ...Object.values(s.bodies)].join("\n")).not.toMatch(/\{\{|\}\}/);
  });
});
