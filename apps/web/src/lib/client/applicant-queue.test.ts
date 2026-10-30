import { describe, expect, test } from "vitest";
import { groupByJob, inOrder, neighbour, readerAnswers, safeHref, selected, type QueueEntry } from "./applicant-queue";

const entry = (id: string, jobId: string, appliedAt: string, over: Partial<QueueEntry> = {}): QueueEntry => ({
  applicationId: id,
  name: `Applicant ${id}`,
  email: `${id}@x.test`,
  jobId,
  jobTitle: `Job ${jobId}`,
  stage: "sourced",
  post: null,
  appliedAt,
  answers: [],
  ...over,
});

describe("groupByJob", () => {
  test("groups by job, newest first, jobs ordered by their newest applicant", () => {
    const groups = groupByJob([
      entry("a", "eng", "2026-10-20T00:00:00Z"),
      entry("b", "design", "2026-10-28T00:00:00Z"),
      entry("c", "eng", "2026-10-25T00:00:00Z"),
    ]);
    expect(groups.map((g) => [g.jobId, g.entries.map((e) => e.applicationId)])).toEqual([
      ["design", ["b"]],
      ["eng", ["c", "a"]],
    ]);
  });

  test("a job without a title still gets a heading", () => {
    expect(groupByJob([entry("a", "eng", "2026-10-20T00:00:00Z", { jobTitle: null })])[0]!.jobTitle).toBe("Untitled job");
  });
});

describe("selection", () => {
  const order = inOrder(groupByJob([entry("a", "j", "2026-10-03T00:00:00Z"), entry("b", "j", "2026-10-02T00:00:00Z"), entry("c", "j", "2026-10-01T00:00:00Z")]));

  test("opens the one asked for, else the first", () => {
    expect(selected(order, "b")!.applicationId).toBe("b");
    expect(selected(order, "gone")!.applicationId).toBe("a");
    expect(selected(order, null)!.applicationId).toBe("a");
    expect(selected([], "a")).toBeNull();
  });

  test("the next ticket is the one below, else the one above", () => {
    expect(neighbour(order, "a")!.applicationId).toBe("b");
    expect(neighbour(order, "c")!.applicationId).toBe("b");
    expect(neighbour(order.slice(0, 1), "a")).toBeNull();
    expect(neighbour(order, "gone")).toBeNull();
  });
});

describe("safeHref", () => {
  test("only http(s) becomes a link", () => {
    expect(safeHref("https://linkedin.com/in/ada")).toBe("https://linkedin.com/in/ada");
    expect(safeHref("http://ada.dev/cv.pdf")).toBe("http://ada.dev/cv.pdf");
    expect(safeHref("linkedin.com/in/ada")).toBe("https://linkedin.com/in/ada");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JavaScript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<b>hi</b>")).toBeNull();
    expect(safeHref("mailto:ada@x.test")).toBeNull();
    expect(safeHref("see my site")).toBeNull();
    expect(safeHref("")).toBeNull();
  });
});

describe("readerAnswers", () => {
  const answers = [
    { questionId: "name", type: "name", label: "Full name", value: "Ada" },
    { questionId: "email", type: "email", label: "Email", value: "ada@x.test" },
    { questionId: "phone", type: "phone", label: "Phone", value: " +1 555 0100 " },
    { questionId: "linkedin", type: "linkedin", label: "LinkedIn profile", value: "linkedin.com/in/ada" },
    { questionId: "resume", type: "resume", label: "Link to your resume", value: "javascript:alert(1)" },
    { questionId: "q_why", type: "long_text", label: "Why us?", value: "<script>x</script>\nhttps://evil.test" },
    { questionId: "q_blank", type: "short_text", label: "Anything else?", value: "  " },
  ];

  test("the phone goes to the header; name, email and blanks are left out; only link questions link", () => {
    const { phone, answers: shown } = readerAnswers(answers);
    expect(phone).toBe("+1 555 0100");
    expect(shown).toEqual([
      { questionId: "linkedin", label: "LinkedIn profile", value: "linkedin.com/in/ada", href: "https://linkedin.com/in/ada" },
      { questionId: "resume", label: "Link to your resume", value: "javascript:alert(1)", href: null },
      { questionId: "q_why", label: "Why us?", value: "<script>x</script>\nhttps://evil.test", href: null },
    ]);
  });
});
