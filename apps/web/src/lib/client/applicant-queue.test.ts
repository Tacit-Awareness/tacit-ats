import { describe, expect, test } from "vitest";
import type { DepartmentsRead } from "./department-tree";
import { groupByJob, groupByTeam, inOrder, neighbour, readerAnswers, safeHref, selected, type QueueEntry } from "./applicant-queue";

const entry = (id: string, jobId: string, appliedAt: string, over: Partial<QueueEntry> = {}): QueueEntry => ({
  applicationId: id,
  candidateId: `p-${id}`,
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
    expect(groups.map((g) => [g.key, g.entries.map((e) => e.applicationId)])).toEqual([
      ["design", ["b"]],
      ["eng", ["c", "a"]],
    ]);
  });

  test("a job without a title still gets a heading", () => {
    expect(groupByJob([entry("a", "eng", "2026-10-20T00:00:00Z", { jobTitle: null })])[0]!.title).toBe("Untitled job");
  });
});

describe("groupByTeam", () => {
  const read: DepartmentsRead = {
    departments: [
      { id: "plat", name: "Platform", parentId: "eng", archived: false },
      { id: "eng", name: "Engineering", parentId: null, archived: false },
      { id: "design", name: "Design", parentId: null, archived: false },
      { id: "old", name: "Old team", parentId: null, archived: true },
      { id: "empty", name: "Sales", parentId: null, archived: false },
    ],
    jobs: [
      { jobId: "j-plat", departmentId: "plat" },
      { jobId: "j-eng", departmentId: "eng" },
      { jobId: "j-design", departmentId: "design" },
      { jobId: "j-old", departmentId: "old" },
      { jobId: "j-none", departmentId: null },
      { jobId: "j-unreadable", departmentId: "someone-elses" },
    ],
  };
  const shape = (groups: ReturnType<typeof groupByTeam>) => groups.map((g) => [g.title, g.entries.map((e) => e.applicationId)]);

  test("each department under its full path, in path order, with empty ones left out and Other last", () => {
    const groups = groupByTeam(
      [
        entry("none", "j-none", "2026-10-29T00:00:00Z"),
        entry("plat", "j-plat", "2026-10-28T00:00:00Z"),
        entry("eng", "j-eng", "2026-10-27T00:00:00Z"),
        entry("design", "j-design", "2026-10-26T00:00:00Z"),
      ],
      read,
    );
    expect(shape(groups)).toEqual([
      ["Design", ["design"]],
      ["Engineering", ["eng"]],
      ["Engineering › Platform", ["plat"]],
      ["Other", ["none"]],
    ]);
    expect(groups.every((g) => g.isTeam)).toBe(true);
  });

  test("a team is newest first, whichever job each applicant came through", () => {
    const groups = groupByTeam(
      [entry("a", "j-design", "2026-10-20T00:00:00Z"), entry("b", "j-design", "2026-10-28T00:00:00Z"), entry("c", "j-design", "2026-10-25T00:00:00Z")],
      read,
    );
    expect(shape(groups)).toEqual([["Design", ["b", "c", "a"]]]);
  });

  test("a job keeps an archived department, as on Job Postings", () => {
    expect(shape(groupByTeam([entry("a", "j-old", "2026-10-20T00:00:00Z")], read))).toEqual([["Old team", ["a"]]]);
  });

  test("a job in no department, one the member cannot read, or one the read never reached is Other", () => {
    const groups = groupByTeam([entry("a", "j-none", "2026-10-22T00:00:00Z"), entry("b", "j-unreadable", "2026-10-21T00:00:00Z"), entry("c", "j-unknown", "2026-10-20T00:00:00Z")], read);
    expect(shape(groups)).toEqual([["Other", ["a", "b", "c"]]]);
  });

  test("with no departments at all the list stays by job", () => {
    const groups = groupByTeam([entry("a", "eng", "2026-10-20T00:00:00Z"), entry("b", "design", "2026-10-28T00:00:00Z")], { departments: [], jobs: [] });
    expect(shape(groups)).toEqual([
      ["Job design", ["b"]],
      ["Job eng", ["a"]],
    ]);
    expect(groups.some((g) => g.isTeam)).toBe(false);
  });

  test("the reading order follows the groups, so J, K and the next ticket walk the list as shown", () => {
    const groups = groupByTeam([entry("a", "j-none", "2026-10-29T00:00:00Z"), entry("b", "j-plat", "2026-10-20T00:00:00Z")], read);
    expect(inOrder(groups).map((e) => e.applicationId)).toEqual(["b", "a"]);
    expect(neighbour(inOrder(groups), "b")!.applicationId).toBe("a");
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
