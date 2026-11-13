import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { CopyButton } from "@/components/copy-button";
import { Empty, Page, PageBar, Tabs, textLink, type Tab } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Application, Fact, PostBody, SHEET_TABS, StatusChip, day, postState, sheetCard, sheetTab, sheetTitle } from "./sheet";

// One job's post, props only (page.tsx does the reads), laid out like
// design/tats's posting editor (#jobs~<role>) for whoever cannot change it
// (../../editor.tsx is the same sheet for whoever can): the sheet as an
// applicant sees it, the facts down the left and the post's text or its
// application form on the right, behind Overview / Application tabs. The
// form's inputs are drawn, not live. The text is the post's own, rendered as
// plain text. As the editor: the post's state beside the title, the links on
// the right of the title row, the sheet one white card.

export type PostingViewPost = Pick<
  clientTools.JobPost,
  "postId" | "title" | "location" | "description" | "status" | "accepting" | "questions" | "applications" | "publishedAt" | "closedAt"
>;

export function PostingView({
  job,
  post,
  postTabs,
  tab,
  tabHref,
  link,
}: {
  job: { id: string; title: string; status: string; location: string | null; department: string | null };
  post: PostingViewPost | null;
  /** One per post when the job has more than one. */
  postTabs: Tab[];
  tab: "overview" | "application";
  tabHref: (tab: "overview" | "application") => string;
  link: { path: string; url: string } | null;
}) {
  const crumbs = [{ href: "/client/jobs", label: "Job Postings" }];
  const board = (
    <Link href={`/client/jobs/${job.id}`} className={textLink}>
      Open the board
    </Link>
  );
  if (!post) {
    return (
      <Page
        narrow
        className="mx-0"
        bar={
          <PageBar crumbs={crumbs} title={job.title}>
            {board}
          </PageBar>
        }
      >
        <section className="rounded-[14px] bg-card px-5 py-4 shadow-[var(--shadow)]">
          <Empty className="m-0">No post for this job yet: nothing about it is on the careers page.</Empty>
        </section>
      </Page>
    );
  }

  return (
    <Page
      className="mx-0 max-w-[1160px]"
      bar={
        <PageBar crumbs={crumbs} title={job.title} lead={<StatusChip accepting={post.accepting} label={postState(post)} />}>
          {link ? (
            <span className="mr-1 flex items-center gap-0.5">
              <a href={link.path} target="_blank" rel="noreferrer" className={textLink}>
                Public page
                <svg viewBox="0 0 16 16" className="size-3 fill-none stroke-current [stroke-width:1.5] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden>
                  <path d="M5.5 10.5l5-5M6.5 5.5h4v4" />
                </svg>
              </a>
              <CopyButton value={link.url} label="Copy the public link" className="rounded-[7px]" />
            </span>
          ) : null}
          {board}
        </PageBar>
      }
    >
      {postTabs.length > 1 ? <Tabs tabs={postTabs} label="Posts on this job" /> : null}

      <article className={sheetCard}>
        <h2 className={`${sheetTitle} mb-6 sm:mb-9`}>{post.title}</h2>
        <div className="grid gap-6 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-12">
          <aside className="flex flex-col">
            <Fact label="Location">{post.location ?? job.location ?? "Not given"}</Fact>
            {job.department ? <Fact label="Department">{job.department}</Fact> : null}
            <Fact label="Job">
              <StatusBadge status={job.status as Parameters<typeof StatusBadge>[0]["status"]} />
            </Fact>
            {post.publishedAt ? <Fact label="Published">{day(post.publishedAt)}</Fact> : null}
            {post.status === "closed" && post.closedAt ? <Fact label="Closed">{day(post.closedAt)}</Fact> : null}
            {post.applications !== null ? <Fact label="Applied">{post.applications}</Fact> : null}
          </aside>
          <div className="min-w-0">
            <nav aria-label="Post" className="mb-7 flex gap-6 border-b border-[color:var(--line)]">
              {(["overview", "application"] as const).map((t) => (
                <Link key={t} href={tabHref(t)} aria-current={tab === t ? "page" : undefined} className={sheetTab(tab === t)}>
                  {SHEET_TABS[t]}
                </Link>
              ))}
            </nav>
            {tab === "overview" ? (
              post.description ? (
                <PostBody text={post.description} />
              ) : (
                <Empty>No description: applicants see the title, the location and the form.</Empty>
              )
            ) : (
              <Application questions={post.questions} />
            )}
          </div>
        </div>
      </article>
    </Page>
  );
}
