"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import type { clientTools } from "@tacit-ats/core";
import { CopyButton } from "@/components/copy-button";
import { Notice, Page, PageBar, Tabs, pillOption, pillTrack, textLink, type Tab } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  CUSTOM_KINDS, OPTIONAL_BUILT_INS, carryOn, draftPayload, leavesPage, previewQuestions, tooBigToSend, type DraftPayload, type DraftQuestion, type EditorDraft, type Made,
  withDepartment,
} from "@/lib/client/posting-draft";
import type { StepSeeds } from "@/lib/client/process-stages";
import type { SaveResult } from "@/lib/client/posting-edits";
import type { DepartmentChoice } from "@/lib/client/postings";
import type { PostBlock } from "@/lib/public/post-text";
import { cn } from "@/lib/utils";
import {
  Answer, Application, ApplicationEnd, Fact, PostBody, Req, ResumeBox, StatusChip, answerBox, applicationSections, day, postState, sheetHeading,
} from "./[id]/post/sheet";
import { createRoleAction, savePostingAction } from "./actions";
import { Editable } from "./editable";
import { POSTING_ERRORS, POSTING_NOTICES, QUESTION_ERRORS, type PostingError, type PostingNotice } from "./messages";

// design/tats's posting editor (#jobs~<role>, #jobs~new): the post as applicants
// see it, every text edited where it sits, and "Preview as applicant" the same
// sheet with the controls gone. What is typed stays here until Save: the
// actions answer with a code, so a refusal loses nothing. A post has one
// description, written out from the blocks (lib/public/post-text.ts). Hiring
// steps are the job's interview plan, which the public page does not read, so
// they sit under "Only your team sees this" and Preview leaves them out.

type EditorPost = Pick<
  clientTools.JobPost,
  "postId" | "status" | "accepting" | "applications" | "publishedAt" | "closedAt" | "updatedAt"
>;

type Status = "live" | "closed" | null;
/** `status` is what the refused save was also doing, for "Save mine over it" to finish. */
type Message = { notice: PostingNotice; keptOnInterviews: number } | { error: PostingError; status: Status };

const select = "border border-[color:var(--line)] bg-transparent px-1.5 py-0.5 text-[12.5px] text-muted-foreground";
const addButton = "mt-1.5 -ml-2 inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[13px] font-medium text-faint transition-colors hover:bg-[color:var(--hover)] hover:text-foreground";

function Plus() {
  return (
    <svg viewBox="0 0 16 16" className="size-3 fill-none stroke-current [stroke-width:1.5]" aria-hidden>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

/** design/tats's `.je-x`: a row's remove, on hover. */
function Remove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Remove"
      onClick={onClick}
      className="grid size-[22px] flex-none place-items-center rounded-full text-faint opacity-0 transition-opacity group-hover/line:opacity-100 hover:bg-[color:var(--hover)] hover:text-foreground focus-visible:opacity-100 max-sm:opacity-100"
    >
      <svg viewBox="0 0 16 16" className="size-3 fill-none stroke-current [stroke-width:1.5]" aria-hidden>
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  );
}

/**
 * A list you type in, as design/tats: Enter starts the next line, Backspace on
 * an empty one removes it. The lines of a section, the hiring steps and a
 * dropdown's choices are all this.
 */
function Lines({
  lines,
  onChange,
  path,
  noun,
  placeholder,
  addLabel,
  numbered,
  focus,
}: {
  lines: string[];
  onChange: (lines: string[]) => void;
  path: string;
  noun: string;
  placeholder: string;
  addLabel: string;
  numbered?: boolean;
  focus: (path: string) => void;
}) {
  const at = (i: number) => `${path}-${i}`;
  const insert = (i: number, added: string[]) => onChange([...lines.slice(0, i), ...added, ...lines.slice(i)]);
  return (
    <>
      <ul className="m-0 list-none p-0">
        {lines.map((line, i) => (
          <li key={i} className={cn("group/line flex gap-2.5 text-muted-foreground", numbered ? "items-center border-b border-[color:var(--line)] py-2 text-foreground" : "items-start py-[3px]")}>
            {numbered ? (
              <em className="grid size-5 flex-none place-items-center bg-[color:var(--soft-strong)] text-[11.5px] font-medium text-muted-foreground not-italic">{i + 1}</em>
            ) : (
              <span className="mt-[9px] size-[5px] flex-none bg-[color:var(--faint)]" />
            )}
            <Editable
              value={line}
              onChange={(v) => onChange(lines.map((l, n) => (n === i ? v : l)))}
              label={`${noun} ${i + 1}`}
              placeholder={placeholder}
              path={at(i)}
              className="min-w-0 flex-1"
              onEnter={() => {
                insert(i + 1, [""]);
                focus(at(i + 1));
              }}
              onBackspaceEmpty={
                lines.length > 1
                  ? () => {
                      onChange(lines.filter((_, n) => n !== i));
                      focus(at(Math.max(0, i - 1)));
                    }
                  : undefined
              }
              onPasteLines={(pasted) => {
                onChange([...lines.slice(0, i), ...(line.trim() ? [line] : []), ...pasted, ...lines.slice(i + 1)]);
                focus(at(i + (line.trim() ? 1 : 0) + pasted.length - 1));
              }}
            />
            <Remove label={`Remove ${noun.toLowerCase()} ${i + 1}`} onClick={() => onChange(lines.filter((_, n) => n !== i))} />
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={addButton}
        onClick={() => {
          insert(lines.length, [""]);
          focus(at(lines.length));
        }}
      >
        <Plus />
        {addLabel}
      </button>
    </>
  );
}

function Overview({ blocks, onChange, focus }: { blocks: PostBlock[]; onChange: (blocks: PostBlock[]) => void; focus: (path: string) => void }) {
  const set = (i: number, next: PostBlock) => onChange(blocks.map((b, n) => (n === i ? next : b)));
  return (
    <div className="text-[14px] leading-[1.55]">
      {blocks.map((b, i) =>
        b.kind === "text" ? (
          <p key={i} className="m-0 mb-3.5">
            <Editable
              value={b.text}
              onChange={(text) => set(i, { ...b, text })}
              label={i === 0 ? "Introduction" : `Paragraph ${i + 1}`}
              placeholder="One or two sentences on what this person will do"
              path={`block-${i}`}
              multiline
              className={cn("block min-h-[1.5em]", i === 0 && "text-[17px] leading-[1.5] tracking-[-0.01em]")}
            />
          </p>
        ) : (
          <div key={i}>
            <h3 className={cn(sheetHeading, "first:mt-7")}>
              <Editable value={b.heading} onChange={(heading) => set(i, { ...b, heading })} label={`Section ${i + 1} heading`} placeholder="A heading" path={`heading-${i}`} className="min-w-[3em]" />
            </h3>
            <Lines lines={b.lines} onChange={(lines) => set(i, { ...b, lines })} path={`lines-${i}`} noun="Line" placeholder="A line" addLabel="Add a line" focus={focus} />
          </div>
        ),
      )}
    </div>
  );
}

function Toggle({ question, onChange }: { question: DraftQuestion; onChange: (patch: Partial<DraftQuestion>) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-faint">
      <input type="checkbox" checked={question.required} onChange={(e) => onChange({ required: e.target.checked })} />
      Required
    </label>
  );
}

function Questions({ questions, onChange, focus }: { questions: DraftQuestion[]; onChange: (questions: DraftQuestion[]) => void; focus: (path: string) => void }) {
  const { resume, about, rest } = applicationSections(questions);
  const patch = (key: string, next: Partial<DraftQuestion>) => onChange(questions.map((q) => (q.key === key ? { ...q, ...next } : q)));
  const remove = (key: string) => onChange(questions.filter((q) => q.key !== key));
  const missing = OPTIONAL_BUILT_INS.filter(([type]) => !questions.some((q) => q.type === type));
  const addBuiltIn = (type: clientTools.QuestionType, label: string) =>
    onChange([...questions, { key: `new-${type}`, type, label, required: false, options: [] }]);
  const addCustom = () => {
    const key = `new-${Date.now()}`;
    onChange([...questions, { key, type: "short_text", label: "", required: false, options: [] }]);
    focus(`question-${key}`);
  };

  return (
    <div className="text-[14px] leading-[1.55]">
      <p className="m-0 mb-1 bg-[color:var(--soft)] px-3 py-2.5 text-[13px] text-muted-foreground">
        Name and email are on every application. Everything else here is yours to change.
      </p>
      {resume.map((q) => (
        <div key={q.key} className="group/line">
          <h3 className={cn(sheetHeading, "items-center first:mt-7")}>
            {q.label}
            <Req on={q.required} />
            <Remove label={`Remove ${q.label}`} onClick={() => remove(q.key)} />
          </h3>
          <ResumeBox />
          <div className="mt-2.5">
            <Toggle question={q} onChange={(next) => patch(q.key, next)} />
          </div>
        </div>
      ))}
      <h3 className={sheetHeading}>About you</h3>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {about.map((q) => {
          const fixed = q.type === "name" || q.type === "email";
          return (
            <div key={q.key} className="group/line flex flex-col gap-1.5 text-[13px]">
              <span className="flex items-center gap-0.5">
                {q.label}
                <Req on={q.required} />
                {fixed ? null : <Remove label={`Remove ${q.label}`} onClick={() => remove(q.key)} />}
              </span>
              <span className={answerBox} />
              {fixed ? null : <Toggle question={q} onChange={(next) => patch(q.key, next)} />}
            </div>
          );
        })}
      </div>
      {missing.length ? (
        <div className="mt-1.5 flex flex-wrap gap-x-3">
          {missing.map(([type, label]) => (
            <button key={type} type="button" className={cn(addButton, "ml-0")} onClick={() => addBuiltIn(type, label)}>
              <Plus />
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <h3 className={sheetHeading}>Questions</h3>
      {rest.map((q) => (
        <div key={q.key} className="border-b border-[color:var(--line)] py-3.5">
          <div className="group/line mb-2.5 flex items-start gap-0.5 font-medium">
            <Editable
              value={q.label}
              onChange={(label) => patch(q.key, { label })}
              label="Question"
              placeholder="Type a question"
              path={`question-${q.key}`}
              className="empty:min-w-[8em]"
            />
            <Req on={q.required} />
            <Remove label={q.label ? `Remove ${q.label}` : "Remove this question"} onClick={() => remove(q.key)} />
          </div>
          {q.type === "select" ? (
            <Lines
              lines={q.options.length ? q.options : [""]}
              onChange={(options) => patch(q.key, { options })}
              path={`option-${q.key}`}
              noun="Choice"
              placeholder="A choice"
              addLabel="Add a choice"
              focus={focus}
            />
          ) : (
            <Answer q={q} />
          )}
          <div className="mt-2.5 flex items-center gap-4">
            <select
              aria-label="Answer type"
              className={select}
              value={q.type}
              onChange={(e) => patch(q.key, { type: e.target.value as clientTools.QuestionType })}
            >
              {CUSTOM_KINDS.map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
            <Toggle question={q} onChange={(next) => patch(q.key, next)} />
          </div>
        </div>
      ))}
      <button type="button" className={addButton} onClick={addCustom}>
        <Plus />
        Add a question
      </button>
      <div>
        <ApplicationEnd />
      </div>
    </div>
  );
}

export function PostingEditor({
  job,
  post,
  initial,
  departments,
  postTabs,
  link,
  tab: firstTab,
  notice,
  seeds = null,
}: {
  /** `id` is null for a role not made yet. */
  job: { id: string | null; title: string; status: string };
  post: EditorPost | null;
  initial: EditorDraft;
  departments: DepartmentChoice[];
  postTabs: Tab[];
  link: { path: string; url: string } | null;
  tab: "overview" | "application";
  notice: PostingNotice | null;
  /** On a new role: each department's way through the company's process. */
  seeds?: StepSeeds | null;
}) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(initial);
  // A new role's steps follow its department until the member changes one of them.
  const [stepsEdited, setStepsEdited] = useState(false);
  const [baseline, setBaseline] = useState(() => JSON.stringify(draftPayload(initial)));
  const [preview, setPreview] = useState(false);
  const [tab, setTab] = useState(firstTab);
  const [message, setMessage] = useState<Message | null>(notice ? { notice, keptOnInterviews: 0 } : null);
  // A job or post made by a save that then stopped: the next save carries on from them.
  const [made, setMade] = useState<Made>({ jobId: null, postId: null });
  const [pending, start] = useTransition();

  const payload = useMemo(() => draftPayload(draft), [draft]);
  const dirty = JSON.stringify(payload) !== baseline;
  const jobId = job.id ?? made.jobId;
  const postId = post?.postId ?? made.postId;

  // Once saved, take the server's copy (a new question's id, say). Not over work in progress.
  const version = post?.updatedAt ?? null;
  const versionSeen = useRef(version);
  useEffect(() => {
    if (versionSeen.current === version) return;
    versionSeen.current = version;
    if (dirty) return;
    setDraft(initial);
    setBaseline(JSON.stringify(draftPayload(initial)));
    // Only a new version from the server is a reason to run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // Closing the tab, and a link in the app, which changes page with no `beforeunload`. The G keys go round this.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]");
      if (!link || !leavesPage(e, link, window.location.href)) return;
      if (window.confirm("Leave without saving? What you changed here will be lost.")) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  // Save is in the bar, which stays on screen; what it answers is at the top of a long page.
  const said = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) said.current?.scrollIntoView({ block: "nearest" });
  }, [message]);

  // A new line's element exists only after the render that adds it, so focus waits for it.
  const pendingFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const path = pendingFocus.current;
    if (!path) return;
    pendingFocus.current = null;
    const el = root.current?.querySelector<HTMLElement>(`[data-ed="${CSS.escape(path)}"]`);
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    selection?.selectAllChildren(el);
    selection?.collapseToEnd();
  });
  const focus = (path: string) => {
    pendingFocus.current = path;
  };

  const save = (status: Status, overwrite = false) =>
    start(async () => {
      setMessage(null);
      const sent = JSON.stringify(payload);
      if (tooBigToSend(sent)) {
        setMessage({ error: "description_too_long", status });
        return;
      }
      // A role made by this page has nothing anyone else could have changed yet.
      const seen = JSON.parse(baseline) as DraftPayload;
      const seenJob = job.id ? { steps: seen.steps, departmentId: seen.departmentId } : null;
      let result: SaveResult;
      try {
        result = jobId
          ? await savePostingAction({ jobId, postId, draft: payload, seenUpdatedAt: post?.updatedAt ?? null, seenJob, overwrite, status })
          : await createRoleAction({ draft: payload, publish: status === "live" });
      } catch {
        result = { ok: false, error: "failed" };
      }
      if (!result.ok) {
        const { jobId: madeJob, postId: madePost } = result;
        setMade((m) => carryOn(m, { jobId: madeJob, postId: madePost }));
        setMessage({ error: result.error, status });
        if (QUESTION_ERRORS.includes(result.error)) {
          setPreview(false);
          setTab("application");
        }
        return;
      }
      setBaseline(sent);
      if (!job.id) {
        router.replace(`/client/jobs/${result.jobId}/post?notice=${result.notice}`);
        return;
      }
      if (!post) setMade((m) => carryOn(m, { postId: result.postId }));
      const live = status === null && post?.status === "live";
      setMessage({ notice: live ? "saved_live" : result.notice, keptOnInterviews: result.keptOnInterviews });
    });

  const isNew = !job.id;
  const jobOpen = job.status === "open";
  const notPublishable = jobOpen ? undefined : `Its job is ${job.status.replace(/_/g, " ")}: a post goes live only on an open job.`;
  

  const bar = (
    <PageBar crumbs={[{ href: "/client/jobs", label: "Job Postings" }]} title={draft.title.trim() || job.title}>
      {link ? (
        <span className="mr-1 flex items-center gap-1">
          <a href={link.path} target="_blank" rel="noreferrer" className={textLink}>
            Public page
          </a>
          <CopyButton value={link.url} label="Copy the public link" />
        </span>
      ) : null}
      {job.id ? (
        <Link href={`/client/jobs/${job.id}`} className={cn(textLink, "mr-1")}>
          Open the board
        </Link>
      ) : null}
      <div role="group" aria-label="Mode" className={pillTrack}>
        <button type="button" aria-pressed={!preview} className={pillOption(!preview)} onClick={() => setPreview(false)}>
          Edit
        </button>
        <button type="button" aria-pressed={preview} className={pillOption(preview)} onClick={() => setPreview(true)}>
          Preview as applicant
        </button>
      </div>
      {post ? <StatusChip accepting={post.accepting} label={postState(post)} /> : <StatusChip accepting={false} label="Not posted" />}
      {post?.status === "live" ? (
        <Button variant="outline" disabled={pending} onClick={() => save("closed")}>
          Close post
        </Button>
      ) : null}
      {post?.status !== "live" ? (
        <>
          {post ? null : (
            <Button variant="outline" disabled={pending} onClick={() => save(null)}>
              Save draft
            </Button>
          )}
          <Button variant={post ? "outline" : "default"} disabled={pending || !jobOpen} title={notPublishable} onClick={() => save("live")}>
            {isNew ? "Post the job" : post?.status === "closed" ? "Reopen" : "Publish"}
          </Button>
        </>
      ) : null}
      {post ? (
        <Button disabled={pending || !dirty} onClick={() => save(null)}>
          {pending ? "Saving…" : "Save"}
        </Button>
      ) : null}
    </PageBar>
  );

  return (
    <Page className="max-w-[1000px]" bar={bar} stickyBar>
      <div ref={root} className="grid gap-4">
        <div ref={said} className="scroll-mt-16 empty:hidden">
          {message ? (
            "error" in message ? (
              <Notice tone="error">
                {POSTING_ERRORS[message.error]}
                {message.error === "changed" ? (
                  <>
                    {" "}
                    <button type="button" className="underline" disabled={pending} onClick={() => save(message.status, true)}>
                      Save mine over it{message.status === "live" ? " and publish" : message.status === "closed" ? " and close" : ""}
                    </button>
                    {" or "}
                    <a className="underline" href={window.location.href}>
                      reload to see theirs
                    </a>
                    .
                  </>
                ) : null}
              </Notice>
            ) : (
              <Notice>
                {POSTING_NOTICES[message.notice]}
                {message.keptOnInterviews > 0
                  ? ` ${message.keptOnInterviews === 1 ? "An interview" : `${message.keptOnInterviews} interviews`} already on a removed step ${message.keptOnInterviews === 1 ? "keeps" : "keep"} its name.`
                  : ""}
              </Notice>
            )
          ) : null}
        </div>
        {postTabs.length > 1 ? <Tabs tabs={postTabs} label="Posts on this job" /> : null}

        <article className="border border-[color:var(--line)] bg-card px-5 py-6 shadow-[var(--shadow)] sm:px-11 sm:pt-10 sm:pb-12">
          {preview ? null : (
            <p className="m-0 mb-2.5 text-[13px] text-faint">
              This is what applicants see. Click any text to change it.
            </p>
          )}
          <h2 className="m-0 mb-5 text-[28px] leading-[1.15] font-medium tracking-[-0.025em] sm:mb-9 sm:text-[38px]">
            {preview ? (
              draft.title
            ) : (
              <Editable value={draft.title} onChange={(title) => setDraft((d) => ({ ...d, title }))} label="Role title" placeholder="Role title" path="title" className="-mx-2.5 -my-1 inline-block min-w-[3em] px-2.5 py-1" />
            )}
          </h2>
          <div className="grid gap-5 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-12">
            <aside className="flex flex-col">
              <Fact label="Location">
                {preview ? (
                  draft.location || "Not given"
                ) : (
                  <Editable value={draft.location} onChange={(location) => setDraft((d) => ({ ...d, location }))} label="Location" placeholder="City" path="location" className="inline-block min-w-[3em]" />
                )}
              </Fact>
              {departments.length ? (
                <Fact label="Department">
                  {preview ? (
                    (departments.find((d) => d.id === draft.departmentId)?.path ?? "None")
                  ) : (
                    <select
                      aria-label="Department"
                      className="-mx-1.5 max-w-full border-0 bg-transparent px-1 py-0.5 text-[13px] text-muted-foreground hover:bg-[color:var(--hover)]"
                      value={draft.departmentId}
                      onChange={(e) => setDraft((d) => withDepartment(d, e.target.value, jobId ? null : seeds, stepsEdited))}
                    >
                      <option value="">None</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.path}
                        </option>
                      ))}
                    </select>
                  )}
                </Fact>
              ) : null}
              {/* The team's, not the applicant's: job_post_page returns none of these. */}
              {job.id && !preview ? (
                <Fact label="Job">
                  <StatusBadge status={job.status as Parameters<typeof StatusBadge>[0]["status"]} />
                </Fact>
              ) : null}
              {post?.publishedAt && !preview ? <Fact label="Published">{day(post.publishedAt)}</Fact> : null}
              {post?.status === "closed" && post.closedAt && !preview ? <Fact label="Closed">{day(post.closedAt)}</Fact> : null}
              {post && post.applications !== null && !preview ? <Fact label="Applied">{post.applications}</Fact> : null}
            </aside>
            <div className="min-w-0">
              <div role="tablist" aria-label="Post" className="mb-6 flex gap-5 border-b border-[color:var(--line)]">
                {(["overview", "application"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "-mb-px h-[34px] border-b-2 text-[13.5px] capitalize transition-colors",
                      tab === t ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {preview ? (
                tab === "overview" ? (
                  payload.description ? (
                    <PostBody text={payload.description} />
                  ) : (
                    <p className="m-0 text-[13.5px] text-faint">No description yet: applicants see the title, the location and the form.</p>
                  )
                ) : (
                  <Application questions={previewQuestions(draft)} />
                )
              ) : tab === "overview" ? (
                <Overview blocks={draft.blocks} onChange={(blocks) => setDraft((d) => ({ ...d, blocks }))} focus={focus} />
              ) : (
                <Questions questions={draft.questions} onChange={(questions) => setDraft((d) => ({ ...d, questions }))} focus={focus} />
              )}
            </div>
          </div>
        </article>

        {preview ? null : (
          <section className="border border-dashed border-[color:var(--line-strong)] px-[22px] py-[18px] text-[14px] leading-[1.55]">
            <h3 className="m-0 mb-1.5 text-xs font-medium tracking-[0.04em] text-faint uppercase">Only your team sees this</h3>
            <p className="m-0 mb-2 text-[13px] font-semibold">Hiring steps</p>
            <Lines
              lines={draft.steps}
              onChange={(steps) => {
                setStepsEdited(true);
                setDraft((d) => ({ ...d, steps }));
              }}
              path="step"
              noun="Step"
              placeholder="A step"
              addLabel="Add a step"
              numbered
              focus={focus}
            />
          </section>
        )}
      </div>
    </Page>
  );
}
