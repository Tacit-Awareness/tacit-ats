"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import type { clientTools } from "@tacit-ats/core";
import { CopyButton } from "@/components/copy-button";
import { MiniTitle, Notice, Page, PageBar, Section, Tabs, pillOption, pillTrack, textLink, type Tab } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { selectClass } from "@/components/ui/input";
import { stripMarks, type Mark } from "@/lib/inline-marks";
import { holdLeave } from "@/lib/leave-guard";
import {
  CUSTOM_KINDS, OPTIONAL_BUILT_INS, carryOn, draftPayload, leavesPage, previewQuestions, tooBigToSend, type DraftPayload, type DraftQuestion, type EditorDraft, type Made,
  withDepartment,
} from "@/lib/client/posting-draft";
import type { StepSeeds } from "@/lib/client/process-stages";
import type { SaveResult } from "@/lib/client/posting-edits";
import type { JobSettings } from "@/lib/client/job-settings-rules";
import type { DepartmentChoice } from "@/lib/client/postings";
import type { PostBlock } from "@/lib/public/post-text";
import { cn } from "@/lib/utils";
import {
  Answer, Application, ApplicationEnd, Fact, PostBody, Req, ResumeBox, SHEET_TABS, StatusChip, answerBox, applicationSections, day, fieldLabel, postState,
  sheetCard, sheetHeading, sheetTab, sheetTitle,
} from "./[id]/post/sheet";
import { createRoleAction, savePostingAction } from "./actions";
import { Editable, type EditableControls } from "./editable";
import { JobSettingsPanel } from "./job-settings";
import { POSTING_ERRORS, POSTING_NOTICES, QUESTION_ERRORS, type PostingError, type PostingNotice } from "./messages";

// design/tats's posting editor (#jobs~<role>, #jobs~new): the post as applicants
// see it, every text edited where it sits, and "Preview as applicant" the same
// sheet with the controls gone. What is typed stays here until Save: the
// actions answer with a code, so a refusal loses nothing. A post has one
// description, written out from the blocks (lib/public/post-text.ts). Hiring
// steps are the job's interview plan, which the public page does not read, so
// they sit under "Only your team sees this" and Preview leaves them out.
//
// In Testbench's look: the title row (sticky) holds the post's state beside
// the title and the actions on the right; the sheet is one white card with
// Edit / Preview as applicant at its top, where it changes what the card
// shows; the team's part is a second card. A text edited in place shows a
// field's edge on hover and a field's ink ring while it is typed in.

type EditorPost = Pick<
  clientTools.JobPost,
  "postId" | "status" | "accepting" | "applications" | "publishedAt" | "closedAt" | "updatedAt"
>;

type Status = "live" | "closed" | null;
/** `status` is what the refused save was also doing, for "Save mine over it" to finish. */
type Message = { notice: PostingNotice; keptOnInterviews: number } | { error: PostingError; status: Status };

/** A question's answer type: a small Testbench field. */
const select = cn(selectClass, "h-[30px] w-auto pr-8 pl-2.5 text-[12.5px]");
/** "Add a line", "Add a step", "Add a question": a ghost button, so it reads as something to press. */
const addButton = cn(buttonVariants({ variant: "ghost", size: "sm" }), "mt-1.5 -ml-2.5 gap-1.5 px-2.5 [&_svg]:size-3");
/** What the sheet is, said once: on the Edit option's hover title and to a screen reader, not as a line over the title. */
const SHEET_HINT = "This is what applicants see. Click any text to change it.";
/** Why Name and Email have no remove: on the About you heading's hover title. */
const ALWAYS_ASKED = "Name and email are on every application. Everything else here is yours to change.";

/** The team's card's mark: an eye with a line through it, bare beside the heading. */
function TeamOnlyIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-[15px] flex-none fill-none stroke-current text-[color:var(--ink-4)] [stroke-width:1.4] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden>
      <path d="M2.5 2.5l11 11M6.6 6.7a2 2 0 0 0 2.7 2.7M4.4 4.6C2.9 5.6 1.9 7 1.5 8c.9 2.2 3.4 4.5 6.5 4.5 1.3 0 2.5-.4 3.5-1M7 3.6c.3 0 .7-.1 1-.1 3.1 0 5.6 2.3 6.5 4.5-.3.7-.8 1.5-1.4 2.2" />
    </svg>
  );
}

/** A list's marker: a small square, never a dot or a number. */
const bullet = "size-[5px] flex-none rounded-[1px] bg-[color:var(--ink-4)]";

function Plus() {
  return (
    <svg viewBox="0 0 16 16" className="size-3 fill-none stroke-current [stroke-width:1.5]" aria-hidden>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

/**
 * A custom question's text with Typeform's B and I beside it, on hover or
 * while it is being edited. A press keeps focus where it is (mousedown is
 * cancelled), so it marks the selection, or the whole question with none.
 */
function QuestionText({ value, onChange, path, required }: { value: string; onChange: (label: string) => void; path: string; required: boolean }) {
  const controls = useRef<EditableControls>(null);
  const button = (mark: Mark, name: string, keys: string, face: string) => (
    <button
      type="button"
      aria-label={name}
      title={`${name} (${keys})`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => controls.current?.toggle(mark)}
      className={cn("grid size-[22px] flex-none place-items-center rounded-[6px] text-[12.5px] text-faint hover:bg-[color:var(--hover)] hover:text-foreground", face)}
    >
      {mark === "bold" ? "B" : "I"}
    </button>
  );
  return (
    <>
      <Editable value={value} onChange={onChange} label="Question" placeholder="Type a question" path={path} formatting controls={controls} className="empty:min-w-[8em]" />
      <Req on={required} />
      <span className="ml-1 flex flex-none gap-0.5 opacity-0 transition-opacity group-hover/line:opacity-100 group-focus-within/line:opacity-100 max-sm:opacity-100">
        {button("bold", "Bold", "⌘B", "font-bold")}
        {button("italic", "Italic", "⌘I", "font-serif italic")}
      </span>
    </>
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
      className="grid size-[22px] flex-none place-items-center rounded-[6px] text-faint opacity-0 transition-opacity duration-150 group-hover/line:opacity-100 hover:bg-[color:var(--hover)] hover:text-foreground focus-visible:opacity-100 max-sm:opacity-100"
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
          <li
            key={i}
            className={cn("group/line flex gap-3", numbered ? "min-h-11 items-center border-b border-[color:var(--line)] py-1.5 text-foreground" : "items-start py-[3px] text-muted-foreground")}
          >
            {/* The order is the list's own, so a step carries no number: the same square as any line. */}
            <span aria-hidden className={cn(bullet, !numbered && "mt-[9px]")} />
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
    <div className="max-w-[680px] font-sans text-[14px] leading-[22px] text-muted-foreground">
      {blocks.map((b, i) =>
        b.kind === "text" ? (
          <p key={i} className="m-0 mb-4">
            <Editable
              value={b.text}
              onChange={(text) => set(i, { ...b, text })}
              label={i === 0 ? "Introduction" : `Paragraph ${i + 1}`}
              placeholder="One or two sentences on what this person will do"
              path={`block-${i}`}
              multiline
              className={cn("block min-h-[22px]", i === 0 && "min-h-[26px] text-[17px] leading-[26px] tracking-[-0.01em] text-foreground")}
            />
          </p>
        ) : (
          <div key={i}>
            <h3 className={cn(sheetHeading, "first:mt-8")}>
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
    <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground">
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
    <div className="text-[13px]">
      <p className="sr-only">{ALWAYS_ASKED}</p>
      {resume.map((q) => (
        <div key={q.key} className="group/line">
          <h3 className={cn(sheetHeading, "items-center")}>
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
      <h3 className={sheetHeading} title={ALWAYS_ASKED}>
        About you
      </h3>
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        {about.map((q) => {
          const fixed = q.type === "name" || q.type === "email";
          return (
            <div key={q.key} className="group/line flex flex-col gap-1.5">
              <span className={cn(fieldLabel, "flex min-h-[22px] items-center gap-0.5")} title={fixed ? "On every application" : undefined}>
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
        <div className="mt-2 flex flex-wrap gap-x-1">
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
        <div key={q.key} className="border-b border-[color:var(--line)] py-4">
          <div className={cn(fieldLabel, "group/line mb-2.5 flex items-start gap-0.5")}>
            <QuestionText value={q.label} onChange={(label) => patch(q.key, { label })} path={`question-${q.key}`} required={q.required} />
            <Remove label={q.label ? `Remove ${stripMarks(q.label)}` : "Remove this question"} onClick={() => remove(q.key)} />
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
          <div className="mt-3 flex items-center gap-4">
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
  settings = null,
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
  /** On a job that exists: its own title, status and openings, saved apart from the post (job-settings.tsx). */
  settings?: JobSettings | null;
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

  // Closing the tab, and a link in the app, which changes page with no `beforeunload`. The G keys and ⌘K ask through holdLeave.
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
    const release = holdLeave();
    return () => {
      release();
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
  const notPublishable = jobOpen ? undefined : `Its job is ${job.status.replace(/_/g, " ")}: a post goes live only on an open job. Its status is under "Only your team sees this".`;
  

  const bar = (
    <PageBar
      crumbs={[{ href: "/client/jobs", label: "Job Postings" }]}
      title={draft.title.trim() || job.title}
      lead={post ? <StatusChip accepting={post.accepting} label={postState(post)} /> : <StatusChip accepting={false} label="Not posted" />}
    >
      {link ? (
        <span className="flex items-center gap-0.5">
          <a href={link.path} target="_blank" rel="noreferrer" className={textLink}>
            Public page
            <svg viewBox="0 0 16 16" className="size-3 fill-none stroke-current [stroke-width:1.5] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden>
              <path d="M5.5 10.5l5-5M6.5 5.5h4v4" />
            </svg>
          </a>
          <CopyButton value={link.url} label="Copy the public link" className="rounded-[7px]" />
        </span>
      ) : null}
      {job.id ? (
        <Link href={`/client/jobs/${job.id}`} className={cn(textLink, "mr-1")}>
          Open the board
        </Link>
      ) : null}
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
    // In a narrower window the actions wrap under the title; they keep to the right there too.
    <Page className="mx-0 max-w-[1160px] pt-4" bar={<div className="[&_.page-bar>div:last-child]:ml-auto">{bar}</div>} stickyBar>
      <div ref={root} className="grid gap-5">
        <div ref={said} className="scroll-mt-20 empty:hidden">
          {message ? (
            "error" in message ? (
              <Notice tone="error">
                {POSTING_ERRORS[message.error]}
                {message.error === "changed" ? (
                  <>
                    {" "}
                    <button type="button" className="underline underline-offset-[3px]" disabled={pending} onClick={() => save(message.status, true)}>
                      Save mine over it{message.status === "live" ? " and publish" : message.status === "closed" ? " and close" : ""}
                    </button>
                    {" or "}
                    <a className="underline underline-offset-[3px]" href={window.location.href}>
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

        <article className={sheetCard}>
          {preview ? null : <p className="sr-only">{SHEET_HINT}</p>}
          <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 sm:mb-9">
            <h2 className={cn(sheetTitle, "min-w-0 flex-1")}>
              {preview ? (
                draft.title
              ) : (
                <Editable value={draft.title} onChange={(title) => setDraft((d) => ({ ...d, title }))} label="Role title" placeholder="Role title" path="title" className="-mx-2.5 -my-1 inline-block min-w-[3em] px-2.5 py-1" />
              )}
            </h2>
            {/* Edit / Preview changes what this card shows, so it sits on the card. */}
            <div role="group" aria-label="Mode" className={cn(pillTrack, "mt-0.5 flex-none")}>
              <button type="button" aria-pressed={!preview} title={SHEET_HINT} className={pillOption(!preview)} onClick={() => setPreview(false)}>
                Edit
              </button>
              <button type="button" aria-pressed={preview} className={pillOption(preview)} onClick={() => setPreview(true)}>
                Preview as applicant
              </button>
            </div>
          </header>
          <div className="grid gap-6 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-12">
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
                      className={cn(selectClass, "h-[34px] max-w-full text-foreground")}
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
              <div role="tablist" aria-label="Post" className="mb-7 flex gap-6 border-b border-[color:var(--line)]">
                {(["overview", "application"] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={sheetTab(tab === t)}>
                    {SHEET_TABS[t]}
                  </button>
                ))}
              </div>
              {preview ? (
                tab === "overview" ? (
                  payload.description ? (
                    <PostBody text={payload.description} />
                  ) : (
                    <p className="m-0 text-[13px] text-faint">No description yet: applicants see the title, the location and the form.</p>
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
          <Section title="Only your team sees this" icon={<TeamOnlyIcon />} className="gap-0 pb-3">
            {settings ? <JobSettingsPanel settings={settings} /> : null}
            <div className="grid gap-1 pt-5">
              <MiniTitle className="mt-0">Hiring steps</MiniTitle>
              <div>
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
              </div>
            </div>
          </Section>
        )}
      </div>
    </Page>
  );
}
