import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/components/toasts", () => ({ showToast: vi.fn() }));

import { JobPostingsView, type PostingRowProps } from "./view";

const row = (over: Partial<PostingRowProps> = {}): PostingRowProps => ({
  jobId: "j1",
  title: "Staff Engineer",
  location: "Remote",
  jobStatus: null,
  post: { label: "Live", tone: "green", title: "On the careers page." },
  link: { path: "/jobs/staff", url: "https://ats.example.com/jobs/staff" },
  applied: 9,
  inPipeline: 4,
  morePosts: 0,
  ...over,
});
const D = "11111111-2222-4333-8444-555555555555";
const view = (canAdd = true) =>
  renderToStaticMarkup(
    <JobPostingsView
      orgName="Acme"
      careersUrl="https://ats.example.com/careers/acme"
      total={2}
      live={1}
      groups={[{ key: D, name: "Engineering", rows: [row(), row({ jobId: "j2", title: "Designer", post: { label: "Draft", tone: "grey", title: "Not public yet." }, inPipeline: null })] }]}
      empty="No jobs yet."
      canAdd={canAdd}
    />,
  );

describe("Listings & Asks", () => {
  test("is the careers page, a band per department, each row opening its posting", () => {
    const html = view();
    expect(html).toContain("Careers at Acme");
    expect(html).toContain("Engineering");
    expect(html).toContain('href="/client/jobs/j1/post"');
    expect(html).toContain("4 in pipeline");
    expect(html).toContain("Careers Page");
  });

  test("a live post says nothing; anything else shows its state", () => {
    const html = view();
    expect(html).toContain(">Draft<");
    expect(html).not.toContain(">Live<");
  });

  test("no stray stats on a row: no applied count, no public link, no Board", () => {
    const html = view();
    expect(html).not.toContain("applied");
    expect(html).not.toContain("/jobs/staff");
    expect(html).not.toContain(">Board<");
  });

  test("an admin adds a role, to the org or to a department", () => {
    expect(view()).toContain('href="/client/jobs/new"');
    expect(view()).toContain(`href="/client/jobs/new?department=${D}"`);
    expect(view(false)).not.toContain("/client/jobs/new");
  });
});
