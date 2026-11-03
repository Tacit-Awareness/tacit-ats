import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { CopyButton } from "@/components/copy-button";
import { Empty, Page, PageBar, Tabs, textLink, type Tab } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { Application, Fact, PostBody, StatusChip, day, postState } from "./sheet";

// One job's post, props only (page.tsx does the reads), laid out like
// design/tats's posting editor (#jobs~<role>) for whoever cannot change it
// (../../editor.tsx is the same sheet for whoever can): the sheet as an
// applicant sees it, the facts down the left and the post's text or its
// application form on the right, behind Overview / Application tabs. The
// form's inputs are drawn, not live. The text is the post's own, rendered as
// plain text.

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
        bar={
          <PageBar crumbs={crumbs} title={job.title}>
            {board}
          </PageBar>
        }
      >
        <Empty>No post for this job yet: nothing about it is on the careers page.</Empty>
      </Page>
    );
  }

  return (
    <Page
      className="max-w-[1000px]"
      bar={
        <PageBar crumbs={crumbs} title={job.title}>
          {link ? (
            <span className="flex items-center gap-1">
              <a href={link.path} target="_blank" rel="noreferrer" className={textLink}>
                Public page
              </a>
              <CopyButton value={link.url} label="Copy the public link" />
            </span>
          ) : null}
          <span className="mx-1">{board}</span>
          <StatusChip accepting={post.accepting} label={postState(post)} />
        </PageBar>
      }
    >
      {postTabs.length > 1 ? <Tabs tabs={postTabs} label="Posts on this job" /> : null}

      <article className="rounded-[12px] border border-[color:var(--line)] bg-card px-5 py-6 shadow-[var(--shadow)] sm:px-11 sm:pt-10 sm:pb-12">
        <h2 className="m-0 mb-5 text-[28px] leading-[1.15] font-medium tracking-[-0.025em] sm:mb-9 sm:text-[38px]">{post.title}</h2>
        <div className="grid gap-5 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-12">
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
            <nav aria-label="Post" className="mb-6 flex gap-5 border-b border-[color:var(--line)]">
              {(["overview", "application"] as const).map((t) => (
                <Link
                  key={t}
                  href={tabHref(t)}
                  aria-current={tab === t ? "page" : undefined}
                  className={cn(
                    "-mb-px h-[34px] border-b-2 text-[13.5px] leading-[34px] capitalize transition-colors",
                    tab === t ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t}
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
