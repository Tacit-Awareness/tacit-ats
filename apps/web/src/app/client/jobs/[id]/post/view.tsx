import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { CopyButton } from "@/components/copy-button";
import { Empty, Page, PageBar, Tabs, textLink, type Tab } from "@/components/page";
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

const box = "block h-9 rounded-lg border border-[color:var(--line-strong)] bg-[color:var(--surface)] px-3 text-[13px] leading-[34px] text-faint";

/** The red asterisk design/tats puts after a required field. */
function Req({ on }: { on: boolean }) {
  return on ? (
    <i className="text-[color:var(--red)] not-italic" title="Required">
      *
    </i>
  ) : null;
}

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

const ABOUT_YOU = new Set<clientTools.QuestionType>(["name", "email", "phone", "linkedin"]);

/** design/tats's application tab: the resume as a drop box, About you as a two-column grid, then the post's other questions. */
function Application({ questions }: { questions: clientTools.Question[] }) {
  const resume = questions.filter((q) => q.type === "resume");
  const about = questions.filter((q) => ABOUT_YOU.has(q.type));
  const rest = questions.filter((q) => q.type !== "resume" && !ABOUT_YOU.has(q.type));
  const h3 = "m-0 mt-7 mb-2.5 flex gap-0.5 text-[14.5px] font-medium first:mt-0";
  return (
    <div className="text-[14px] leading-[1.55]">
      {resume.map((q) => (
        <div key={q.questionId}>
          <h3 className={h3}>
            {q.label}
            <Req on={q.required} />
          </h3>
          <div className="flex flex-col items-center gap-1 rounded-[10px] border-[1.5px] border-dashed border-[color:var(--line-strong)] p-6 text-[13.5px] text-muted-foreground">
            <svg viewBox="0 0 16 16" className="mb-1 size-[18px] fill-none stroke-current text-faint [stroke-width:1.5] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden>
              <path d="M4 1.75h5.5L12.5 4.75v9.5h-8.5z M9.25 1.75v3.25h3.25" />
            </svg>
            <b className="font-medium">Paste a link to your resume</b>
            <small className="text-xs text-faint">A link for now: no upload yet</small>
          </div>
        </div>
      ))}
      {about.length ? (
        <>
          <h3 className={h3}>About you</h3>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {about.map((q) => (
              <div key={q.questionId} className="flex flex-col gap-1.5 text-[13px]">
                <span>
                  {q.label}
                  <Req on={q.required} />
                </span>
                <span className={box} />
              </div>
            ))}
          </div>
        </>
      ) : null}
      {rest.length ? (
        <>
          <h3 className={h3}>Questions</h3>
          {rest.map((q) => (
            <div key={q.questionId} className="border-b border-[color:var(--line)] py-3.5">
              <div className="mb-2.5 flex items-start gap-0.5 font-medium">
                {q.label}
                <Req on={q.required} />
              </div>
              <Answer q={q} />
            </div>
          ))}
        </>
      ) : null}
      <p className="mt-6 mb-0 text-[13.5px] text-muted-foreground">
        Voluntary self-identification <span className="ml-1.5 text-faint">Optional, never shown to your team</span>
      </p>
      <span className="mt-5 inline-grid h-10 place-items-center rounded-[10px] bg-foreground px-[18px] text-[14px] font-medium text-background opacity-85">
        Submit application
      </span>
    </div>
  );
}

/** design/tats's status chip: an 8px dot and the post's state. */
function StatusChip({ accepting, label }: { accepting: boolean; label: string }) {
  return (
    <span
      className="inline-flex h-7 items-center gap-[7px] rounded-lg border border-[color:var(--line)] px-2.5 text-[13px] whitespace-nowrap"
      title={accepting ? "Shown on the careers page" : "Not on the careers page"}
    >
      <i className={cn("inline-block size-2 flex-none rounded-full", accepting ? "bg-[color:var(--green)]" : "bg-[color:var(--faint)]")} />
      {label}
    </span>
  );
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
      <Page
        narrow
        bar={
          <PageBar crumbs={crumbs} title={job.title}>
            {board}
          </PageBar>
        }
      >
        <Empty>
          No post for this job yet: nothing about it is on the careers page.
          {connectorNote ? (
            <>
              {" "}
              Write one with your Claude connector&apos;s create_job_post.
            </>
          ) : null}
        </Empty>
      </Page>
    );
  }

  const state = post.status === "live" ? (post.accepting ? "Live" : "Live, not taking applications") : post.status === "draft" ? "Draft" : "Closed";
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
          <StatusChip accepting={post.accepting} label={state} />
        </PageBar>
      }
    >
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
              <Application questions={post.questions} />
            )}
          </div>
        </div>
      </article>
      {connectorNote ? (
        <p className="m-0 text-xs text-faint">
          Read-only here. Change the text, the questions or whether it is live with your Claude connector (update_job_post,
          set_job_post_status).
        </p>
      ) : null}
    </Page>
  );
}
