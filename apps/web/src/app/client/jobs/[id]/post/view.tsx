import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { CopyButton } from "@/components/copy-button";
import { Empty, Page, PageHeader, Pill, Tabs, textLink, type Tab } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

// One job's post, props only (page.tsx does the reads), laid out like
// design/tats's posting editor (#jobs~<role>) but read-only: the sheet as an
// applicant sees it, the facts down the left and the post's text or its
// application form on the right, behind Overview / Application tabs. The
// form's inputs are drawn, not live. The text is the post's own, rendered as
// plain text.

export type PostingViewPost = Pick<
  clientTools.JobPost,
  "postId" | "title" | "location" | "description" | "status" | "accepting" | "questions" | "applications" | "publishedAt" | "closedAt"
>;

const TYPE_LABEL: Record<clientTools.QuestionType, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  linkedin: "LinkedIn",
  resume: "Resume link",
  short_text: "Short answer",
  long_text: "Long answer",
  yes_no: "Yes / No",
  select: "Choice",
};

const box = "block h-9 rounded-lg border border-[color:var(--line-strong)] bg-[color:var(--surface)] px-3 text-[13px] leading-[34px] text-faint";

function Answer({ q }: { q: clientTools.Question }) {
  if (q.type === "yes_no") {
    return (
      <span className="flex gap-2">
        {["Yes", "No"].map((v) => (
          <i key={v} className="inline-grid h-8 place-items-center rounded-lg border border-[color:var(--line-strong)] px-[18px] text-[13px] text-muted-foreground not-italic">
            {v}
          </i>
        ))}
      </span>
    );
  }
  if (q.type === "select") {
    return (
      <span className="flex flex-wrap gap-1.5">
        {(q.options ?? []).map((o) => (
          <i key={o} className="rounded-md border border-[color:var(--line)] px-2 py-0.5 text-[12.5px] text-muted-foreground not-italic">
            {o}
          </i>
        ))}
      </span>
    );
  }
  return <span className={cn(box, q.type === "long_text" && "h-24")} />;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[color:var(--line)] py-3 text-[13px] first:pt-0">
      <b className="text-[12.5px] font-semibold">{label}</b>
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function PostingView({
  job,
  post,
  postTabs,
  tab,
  tabHref,
  link,
  connectorNote,
}: {
  job: { id: string; title: string; status: string; location: string | null; department: string | null };
  post: PostingViewPost | null;
  /** One per post when the job has more than one. */
  postTabs: Tab[];
  tab: "overview" | "application";
  tabHref: (tab: "overview" | "application") => string;
  link: { path: string; url: string } | null;
  /** Whether to say where posts are written: not for an interviewer, who cannot. */
  connectorNote: boolean;
}) {
  const crumbs = [{ href: "/client/jobs", label: "Job Postings" }];
  const board = (
    <Link href={`/client/jobs/${job.id}`} className={textLink}>
      Open the board
    </Link>
  );
  if (!post) {
    return (
      <Page narrow>
        <PageHeader crumbs={crumbs} title={job.title} actions={board} />
        <Empty>
          No post for this job yet: nothing about it is on the careers page.
          {connectorNote ? (
            <>
              {" "}
              Write one with your Claude connector&apos;s <code className="font-mono">create_job_post</code>.
            </>
          ) : null}
        </Empty>
      </Page>
    );
  }

  const state = post.status === "live" ? (post.accepting ? "Live" : "Live, not taking applications") : post.status === "draft" ? "Draft" : "Closed";
  return (
    <Page className="max-w-[1000px]">
      <PageHeader
        crumbs={crumbs}
        title={job.title}
        badge={
          <Pill tone={post.accepting ? "green" : "grey"} title={post.accepting ? "Shown on the careers page" : "Not on the careers page"}>
            {state}
          </Pill>
        }
        actions={
          <>
            {link ? (
              <span className="flex items-center gap-1">
                <a href={link.path} target="_blank" rel="noreferrer" className={textLink}>
                  Public page
                </a>
                <CopyButton value={link.url} label="Copy the public link" />
              </span>
            ) : null}
            {board}
          </>
        }
      />
      {postTabs.length > 1 ? <Tabs tabs={postTabs} label="Posts on this job" /> : null}

      <article className="rounded-2xl border border-[color:var(--line)] bg-card px-5 py-6 shadow-[var(--shadow)] sm:px-11 sm:pt-10 sm:pb-12">
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
                <div className="text-[14px] leading-[1.7] whitespace-pre-line text-foreground/85">{post.description}</div>
              ) : (
                <Empty>No description: applicants see the title, the location and the form.</Empty>
              )
            ) : (
              <div className="text-[14px]">
                <h3 className="m-0 mb-1 text-[14.5px] font-medium">Questions</h3>
                {post.questions.map((q) => (
                  <div key={q.questionId} className="border-b border-[color:var(--line)] py-3.5">
                    <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 font-medium">
                      <span>
                        {q.label}
                        {q.required ? <i className="text-negative not-italic"> *</i> : null}
                      </span>
                      <span className="text-xs font-normal text-faint">
                        {TYPE_LABEL[q.type]}
                        {q.required ? ", required" : ", optional"}
                      </span>
                    </div>
                    <Answer q={q} />
                  </div>
                ))}
                <p className="mt-6 mb-0 text-[13.5px] text-muted-foreground">
                  Voluntary self-identification <span className="ml-1.5 text-faint">Optional, never shown to your team</span>
                </p>
                <span className="mt-5 inline-grid h-10 place-items-center rounded-[10px] bg-foreground px-[18px] text-[14px] font-medium text-background opacity-85">
                  Submit application
                </span>
              </div>
            )}
          </div>
        </div>
      </article>
      {connectorNote ? (
        <p className="m-0 text-xs text-faint">
        Read-only here. Change the text, the questions or whether it is live with your Claude connector (
        <code className="font-mono">update_job_post</code>, <code className="font-mono">set_job_post_status</code>).
        </p>
      ) : null}
    </Page>
  );
}
