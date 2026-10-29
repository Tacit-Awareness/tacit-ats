import { describe, expect, it } from "vitest";

import { booleanFlags, describeFlags, parseArgv, toolArguments, UsageError, type ArgsDeps } from "./flags.js";
import { TOOLS } from "./test-helpers/fake-tacit.js";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const ID = "3f6c2a1e-8b4d-4c2a-9e1f-0a1b2c3d4e5f";
const ID2 = "7d9e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a";

const files: Record<string, Buffer> = { "/tmp/priya_resume.pdf": Buffer.from("%PDF-1.7 hello") };
const deps: ArgsDeps = {
  readFile: async (p) => {
    if (!files[p]) throw new Error("ENOENT");
    return files[p]!;
  },
  readStdin: async () => JSON.stringify({ job_id: ID, steps: ["Phone screen"] }),
};

const argsFor = (name: string, argv: string[]) => {
  const t = tool(name);
  return toolArguments(t, parseArgv([name, ...argv], booleanFlags(t)), deps);
};

describe("parseArgv", () => {
  it("splits flags and values, = or space, and -- ends flags", () => {
    const p = parseArgv(["get-pipeline", "--job-id", ID, "--json", "--x=1", "--", "--literal"], booleanFlags(null));
    expect(p.positionals).toEqual(["get-pipeline", "--literal"]);
    expect(p.flags).toEqual([
      { name: "job_id", value: ID },
      { name: "json", value: null },
      { name: "x", value: "1" },
    ]);
  });

  it("does not swallow the next flag as a value", () => {
    const p = parseArgv(["x", "--a", "--b", "v"], () => false);
    expect(p.flags).toEqual([{ name: "a", value: null }, { name: "b", value: "v" }]);
  });
});

describe("toolArguments against the connector's real schemas", () => {
  it("maps kebab flags to properties and checks enums", async () => {
    expect(await argsFor("update_stage", ["--application-id", ID, "--stage", "interviewing", "--expected_stage", "screening"])).toEqual({
      application_id: ID,
      stage: "interviewing",
      expected_stage: "screening",
    });
    await expect(argsFor("update_stage", ["--application-id", ID, "--stage", "onsite"])).rejects.toThrow(/--stage is one of sourced, .*"onsite"/);
  });

  it("names what is missing", async () => {
    await expect(argsFor("update_stage", ["--stage", "hired"])).rejects.toThrow("update_stage needs --application-id");
  });

  it("refuses a flag the tool does not take, listing the ones it does", async () => {
    const err = await argsFor("update_stage", ["--application-id", ID, "--stage", "hired", "--nope", "1"]).catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toMatch(/has no --nope\. It takes --application-id, --stage/);
  });

  it("repeats a list flag, or takes a JSON array; [] clears", async () => {
    expect(await argsFor("set_interview_plan", ["--job-id", ID, "--steps", "Phone screen", "--steps", "Onsite"])).toEqual({
      job_id: ID,
      steps: ["Phone screen", "Onsite"],
    });
    expect(await argsFor("set_interview_plan", ["--job-id", ID, "--steps", "[]"])).toEqual({ job_id: ID, steps: [] });
  });

  it("takes null for a nullable property", async () => {
    expect(await argsFor("update_job", ["--job-id", ID, "--location", "null", "--title", "Backend Engineer"])).toEqual({
      job_id: ID,
      location: null,
      title: "Backend Engineer",
    });
  });

  it("parses numbers and refuses a fraction for an integer", async () => {
    const base = ["--interview-id", ID, "--recommendation", "yes", "--notes", "Strong systems design."];
    expect(await argsFor("submit_feedback", [...base, "--rating", "3"])).toMatchObject({ rating: 3 });
    await expect(argsFor("submit_feedback", [...base, "--rating", "2.5"])).rejects.toThrow("--rating takes a whole number");
  });

  it("takes JSON for a list of objects", async () => {
    const ratings = [{ attribute_id: ID2, rating: 4 }];
    expect(
      await argsFor("submit_feedback", ["--interview-id", ID, "--recommendation", "yes", "--notes", "n", "--ratings", JSON.stringify(ratings)]),
    ).toMatchObject({ ratings });
    await expect(argsFor("submit_feedback", ["--interview-id", ID, "--recommendation", "yes", "--ratings", "{oops"])).rejects.toThrow(
      "--ratings takes JSON",
    );
  });

  it("takes plain text where a value may be text, and JSON otherwise", async () => {
    const base = ["--object", "candidate", "--object-id", ID, "--field", "Visa"];
    expect(await argsFor("set_custom_field", [...base, "--value", "H-1B transfer"])).toMatchObject({ value: "H-1B transfer" });
    expect(await argsFor("set_custom_field", [...base, "--value", '["a","b"]'])).toMatchObject({ value: ["a", "b"] });
    expect(await argsFor("set_custom_field", [...base, "--value", "null"])).toMatchObject({ value: null });
  });

  it("reads a local file into content_base64, with the name and type from the path", async () => {
    expect(await argsFor("add_file", ["--candidate-id", ID, "--kind", "resume", "--content-file", "/tmp/priya_resume.pdf"])).toEqual({
      candidate_id: ID,
      kind: "resume",
      filename: "priya_resume.pdf",
      content_type: "application/pdf",
      content_base64: Buffer.from("%PDF-1.7 hello").toString("base64"),
    });
    await expect(argsFor("add_file", ["--candidate-id", ID, "--kind", "resume", "--content-file", "/tmp/missing.pdf"])).rejects.toThrow(
      "Could not read /tmp/missing.pdf",
    );
  });

  it("takes the whole object from --input, inline or stdin, with flags on top", async () => {
    expect(await argsFor("set_interview_plan", ["--input", "-", "--steps", "Onsite"])).toEqual({ job_id: ID, steps: ["Onsite"] });
    expect(await argsFor("update_stage", ["--input", JSON.stringify({ application_id: ID, stage: "hired" })])).toEqual({
      application_id: ID,
      stage: "hired",
    });
    await expect(argsFor("update_stage", ["--input", "[1]"])).rejects.toThrow("--input takes a JSON object");
  });

  it("ignores tats's own flags", async () => {
    expect(await argsFor("whoami", ["--json", "--yes"])).toEqual({});
  });
});

describe("describeFlags", () => {
  it("shows each flag's shape and whether it is required", () => {
    const lines = describeFlags(tool("update_job")).join("\n");
    expect(lines).toContain("--job-id <string>  [required]");
    expect(lines).toContain("--status <open|paused|filled|closed>");
    expect(lines).toContain("--location <string>  [null clears]");
    expect(lines).toContain("--offices <string> (repeatable)");
    expect(describeFlags(tool("add_file")).join("\n")).toContain("or --content-file <path>");
  });
});
