import { describe, expect, test } from "vitest";
import type { clientTools } from "@tacit-ats/core";
import { groupPostings, leadPost, liveCount, postState, type PostingJob } from "./posting-groups";

const job = (id: string, over: Partial<PostingJob> = {}): PostingJob => ({
  id, title: id, status: "open", location: null, departmentId: null, inPipeline: 0, ...over,
});

const post = (postId: string, jobId: string, over: Partial<clientTools.JobPost> = {}): clientTools.JobPost => ({
  postId, jobId, jobTitle: jobId, title: jobId, location: null, description: null, status: "live", slug: `slug${postId}`,
  accepting: true, questions: [], applications: 0, publishedAt: null, closedAt: null, updatedAt: "2026-10-01T00:00:00Z", ...over,
});

const dept = (departmentId: string, path: string, over: Partial<clientTools.Department> = {}): clientTools.Department => ({
  departmentId, name: path.split(" > ").at(-1)!, parentId: null, path, archived: false, jobs: 0, ...over,
});

describe("leadPost", () => {
  test("live beats a draft beats a closed one, newest first within each", () => {
    const closed = post("c", "j", { status: "closed", accepting: false, updatedAt: "2026-10-09T00:00:00Z" });
    const draft = post("d", "j", { status: "draft", accepting: false, updatedAt: "2026-10-08T00:00:00Z" });
    const oldLive = post("l1", "j", { updatedAt: "2026-10-01T00:00:00Z" });
    const newLive = post("l2", "j", { updatedAt: "2026-10-05T00:00:00Z" });
    expect(leadPost([closed, draft, oldLive, newLive])?.postId).toBe("l2");
    expect(leadPost([closed, draft])?.postId).toBe("d");
    expect(leadPost([])).toBeNull();
  });
});

describe("groupPostings", () => {
  const departments = [dept("eng-p", "Engineering > Platform"), dept("eng", "Engineering"), dept("design", "Design"), dept("empty", "Sales")];

  test("by department in path order, empty departments dropped, jobs in none last under Other", () => {
    const groups = groupPostings(
      {
        departments,
        jobs: [
          job("a", { departmentId: "eng" }),
          job("b", { departmentId: "eng-p" }),
          job("c", { departmentId: "design" }),
          job("d"),
          job("e", { departmentId: "gone" }),
        ],
        posts: [],
      },
      { grouped: true },
    );
    expect(groups.map((g) => [g.name, g.postings.map((p) => p.job.id)])).toEqual([
      ["Design", ["c"]],
      ["Engineering", ["a"]],
      ["Engineering > Platform", ["b"]],
      ["Other", ["d", "e"]],
    ]);
  });

  test("open jobs first, then pending, paused, filled, closed; by title within", () => {
    const [group] = groupPostings(
      {
        departments: [],
        jobs: [
          job("Zed", { status: "closed" }),
          job("Yak", { status: "paused" }),
          job("Bee"),
          job("Ant"),
          job("Cat", { status: "filled" }),
          job("Dog", { status: "pending_approval" }),
        ],
        posts: [],
      },
      { grouped: true },
    );
    expect(group!.postings.map((p) => p.job.id)).toEqual(["Ant", "Bee", "Dog", "Yak", "Cat", "Zed"]);
  });

  test("applied sums every post on the job; null for an interviewer", () => {
    const posts = [post("1", "a", { applications: 3 }), post("2", "a", { status: "closed", accepting: false, applications: 4 })];
    const [full] = groupPostings({ departments: [], jobs: [job("a"), job("b")], posts }, { grouped: true });
    expect(full!.postings.map((p) => [p.job.id, p.applied, p.posts, p.post?.postId ?? null])).toEqual([
      ["a", 7, 2, "1"],
      ["b", 0, 0, null],
    ]);

    const limited = groupPostings(
      { departments: [], jobs: [job("a", { inPipeline: null })], posts: [post("1", "a", { applications: null })] },
      { grouped: false },
    );
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({ key: "all", name: null });
    expect(limited[0]!.postings[0]!.applied).toBeNull();
  });

  test("ungrouped ignores departments; no jobs is no groups", () => {
    const groups = groupPostings({ departments, jobs: [job("a", { departmentId: "eng" }), job("b")], posts: [] }, { grouped: false });
    expect(groups.map((g) => g.postings.length)).toEqual([2]);
    expect(groupPostings({ departments, jobs: [], posts: [] }, { grouped: true })).toEqual([]);
    expect(groupPostings({ departments, jobs: [], posts: [] }, { grouped: false })).toEqual([]);
  });
});

describe("postState and liveCount", () => {
  test("green only while the public page takes applications", () => {
    expect(postState({ job: job("a"), post: null }).label).toBe("No post");
    expect(postState({ job: job("a"), post: post("1", "a", { status: "draft", accepting: false }) })).toMatchObject({ label: "Draft", tone: "grey" });
    expect(postState({ job: job("a"), post: post("1", "a", { status: "closed", accepting: false }) })).toMatchObject({ label: "Closed", tone: "grey" });
    expect(postState({ job: job("a"), post: post("1", "a") })).toMatchObject({ label: "Live", tone: "green" });
    const paused = postState({ job: job("a", { status: "paused" }), post: post("1", "a", { accepting: false }) });
    expect(paused).toMatchObject({ label: "Live", tone: "grey" });
    expect(paused.title).toContain("paused");
  });

  test("counts the jobs whose lead post is accepting", () => {
    const groups = groupPostings(
      {
        departments: [],
        jobs: [job("a"), job("b", { status: "paused" }), job("c")],
        posts: [post("1", "a"), post("2", "b", { accepting: false }), post("3", "c", { status: "draft", accepting: false })],
      },
      { grouped: true },
    );
    expect(liveCount(groups)).toBe(1);
  });
});
