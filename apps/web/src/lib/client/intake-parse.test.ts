import { describe, expect, test } from "vitest";
import { jobInText, nameFromSlug, profileLabel, understand } from "./intake-parse";

const JOBS = [
  { jobId: "fe-infra", title: "Founding Engineer, Infra" },
  { jobId: "pd", title: "Founding Product Designer" },
  { jobId: "pe", title: "Product Engineer" },
  { jobId: "rs", title: "Research Scientist, Post-training" },
  { jobId: "se-inf", title: "Staff Engineer, Inference" },
];
const TEAM = ["Ryan Huang", "Sam Whitaker", "Priya Raman", "Sam Okafor", "Lena Park"];
const applicant = (text: string, preferJob: string | null = null) => understand(text, { jobs: JOBS, preferJob, kind: "applicant" });
const referral = (text: string) => understand(text, { jobs: JOBS, kind: "referral", teammates: TEAM, me: "Ryan Huang" });

describe("understand", () => {
  test("Hy's example: name, email, profile, and the rest as the note", () => {
    expect(applicant("Maya Chen, maya@acme.com, linkedin.com/in/maya-chen. Met her at the infra meetup, strong on queues")).toEqual({
      name: "Maya Chen",
      email: "maya@acme.com",
      linkedinUrl: "linkedin.com/in/maya-chen",
      jobId: null,
      referredBy: null,
      note: "Met her at the infra meetup, strong on queues",
    });
  });

  test("an address in angle brackets, as a pasted signature has it", () => {
    expect(applicant("Ada Lovelace <ada@engine.org>")).toMatchObject({ name: "Ada Lovelace", email: "ada@engine.org", note: "" });
  });

  test("typed in lower case, the name is capitalised", () => {
    expect(applicant("maya chen maya@acme.com").name).toBe("Maya Chen");
  });

  test("with no name in front, the LinkedIn slug names them, its suffix dropped", () => {
    expect(applicant("Met at the infra meetup https://www.linkedin.com/in/maya-chen-4a5b12/ strong on queues")).toMatchObject({
      name: "Maya Chen",
      linkedinUrl: "https://www.linkedin.com/in/maya-chen-4a5b12/",
      note: "Met at the infra meetup strong on queues",
    });
  });

  test("a sentence first is not a name", () => {
    expect(applicant("Strong on queues, maya@acme.com").name).toBeNull();
    expect(applicant("Infra meetup, maya@acme.com").name).toBeNull();
    expect(applicant("Hi, adding someone").name).toBeNull();
  });

  test("a name that runs into a sentence is the name, and the sentence stays whole", () => {
    expect(applicant("Maya Chen is great on queues")).toMatchObject({ name: "Maya Chen", note: "Maya Chen is great on queues" });
  });

  test("particles keep their case", () => {
    expect(applicant("Ana de Souza, ana@x.test").name).toBe("Ana de Souza");
  });

  test("labels pasted from somewhere else", () => {
    expect(applicant("Name: Maya Chen\nEmail: maya@acme.com\nLinkedIn: linkedin.com/in/maya-chen\nGreat on queues")).toMatchObject({
      name: "Maya Chen",
      email: "maya@acme.com",
      linkedinUrl: "linkedin.com/in/maya-chen",
      note: "Great on queues",
    });
  });

  test("the job named in the text, else none (the composer uses the one in view)", () => {
    expect(applicant("Maya Chen, for the founding engineer role").jobId).toBe("fe-infra");
    expect(applicant("Maya Chen, product engineer").jobId).toBe("pe");
    expect(applicant("Maya Chen, Founding Product Designer").jobId).toBe("pd");
    expect(applicant("Maya Chen").jobId).toBeNull();
  });

  test("a job title standing alone at the end names the job and leaves the note; one inside a sentence stays", () => {
    expect(referral("Omar Haddad, omar@acme.com. Referred by Lena, great on evals. Research Scientist, Post-training")).toMatchObject({
      jobId: "rs",
      referredBy: "Lena Park",
      note: "great on evals.",
    });
    expect(applicant("Maya Chen, product engineer")).toMatchObject({ jobId: "pe", note: "" });
    expect(applicant("Maya Chen\nProduct Engineer.")).toMatchObject({ jobId: "pe", note: "" });
    expect(applicant("Maya Chen\nmaya@acme.com\nFounding Engineer, Infra\n\nMet her at the meetup.")).toMatchObject({ jobId: "fe-infra", note: "Met her at the meetup." });
    expect(applicant("Maya Chen, Founding Engineer, Infra, met at the meetup")).toMatchObject({ jobId: "fe-infra", note: "Founding Engineer, Infra, met at the meetup" });
    // A job title alone is the job, not a name.
    expect(applicant("Research Scientist, Post-training")).toMatchObject({ name: null, jobId: "rs", note: "" });
    expect(applicant("Maya Chen, for the founding engineer role")).toMatchObject({ jobId: "fe-infra", note: "for the founding engineer role" });
    expect(applicant("Maya Chen, a product engineer at Stripe")).toMatchObject({ jobId: "pe", note: "a product engineer at Stripe" });
  });

  test("a referral reads who referred them, a teammate named in full", () => {
    expect(referral("Maya Chen, maya@acme.com. Referred by Lena, they worked together at Stripe")).toMatchObject({
      name: "Maya Chen",
      referredBy: "Lena Park",
      note: "they worked together at Stripe",
    });
    // Two Sams: kept as typed.
    expect(referral("Maya Chen, referred by Sam").referredBy).toBe("Sam");
    expect(referral("Maya Chen, referred by sam whitaker").referredBy).toBe("Sam Whitaker");
    expect(referral("Maya Chen, referred by me").referredBy).toBe("Ryan Huang");
    expect(referral("Maya Chen, referred by Dana Cole who ran infra at Stripe").referredBy).toBe("Dana Cole");
    expect(referral("Maya Chen").referredBy).toBeNull();
  });

  test("an applicant's note keeps a referrer: it isn't a referral", () => {
    expect(applicant("Maya Chen, referred by Sam").note).toBe("referred by Sam");
  });

  test("nothing typed, nothing understood", () => {
    expect(applicant("")).toEqual({ name: null, email: null, linkedinUrl: null, jobId: null, referredBy: null, note: "" });
  });
});

describe("jobInText", () => {
  test("a whole title beats a role", () => {
    expect(jobInText("staff engineer, inference", JOBS)).toBe("se-inf");
  });

  test("a tie goes to the job in view", () => {
    const two = [
      { jobId: "a", title: "Founding Engineer, Infra" },
      { jobId: "b", title: "Founding Engineer, Evals" },
    ];
    expect(jobInText("a founding engineer", two)).toBe("a");
    expect(jobInText("a founding engineer", two, "b")).toBe("b");
    expect(jobInText("a founding engineer for evals", two)).toBe("b");
  });
});

describe("nameFromSlug and profileLabel", () => {
  test("two parts or none", () => {
    expect(nameFromSlug("linkedin.com/in/maya-chen-123456")).toBe("Maya Chen");
    expect(nameFromSlug("linkedin.com/in/mchen")).toBeNull();
  });

  test("the chip's short form", () => {
    expect(profileLabel("https://www.linkedin.com/in/maya-chen/")).toBe("in/maya-chen");
  });
});
