import type { clientTools } from "@tacit-ats/core";
import { cn } from "@/lib/utils";
import { parsePostText } from "@/lib/public/post-text";

// The pieces of design/tats's posting sheet, shared by the read-only post
// (view.tsx) and the editor's Preview (../../editor.tsx), so "Preview as
// applicant" draws what the post itself draws. Props only.

export const answerBox = "block h-9 border border-[color:var(--line-strong)] bg-[color:var(--surface)] px-3 text-[13px] leading-[34px] text-faint";
export const sheetHeading = "m-0 mt-7 mb-2.5 flex gap-0.5 text-[14.5px] font-medium first:mt-0";

/** The red asterisk design/tats puts after a required field. */
export function Req({ on }: { on: boolean }) {
  return on ? (
    <i className="text-[color:var(--red)] not-italic" title="Required">
      *
    </i>
  ) : null;
}

export function Answer({ q }: { q: Pick<clientTools.Question, "type" | "options"> }) {
  if (q.type === "yes_no") {
    return (
      <span className="flex gap-2">
        {["Yes", "No"].map((v) => (
          <i key={v} className="inline-grid h-8 place-items-center rounded-full border border-[color:var(--line-strong)] px-[18px] text-[13px] text-muted-foreground not-italic">
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
          <i key={o} className="rounded-full border border-[color:var(--line)] px-2.5 py-0.5 text-[12.5px] text-muted-foreground not-italic">
            {o}
          </i>
        ))}
      </span>
    );
  }
  return <span className={cn(answerBox, q.type === "long_text" && "h-24")} />;
}

export function ResumeBox() {
  return (
    <div className="flex flex-col items-center gap-1 rounded-[12px] border-[1.5px] border-dashed border-[color:var(--line-strong)] p-6 text-[13.5px] text-muted-foreground">
      <svg viewBox="0 0 16 16" className="mb-1 size-[18px] fill-none stroke-current text-faint [stroke-width:1.5] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden>
        <path d="M4 1.75h5.5L12.5 4.75v9.5h-8.5z M9.25 1.75v3.25h3.25" />
      </svg>
      <b className="font-medium">Paste a link to your resume</b>
      <small className="text-xs text-faint">A link for now: no upload yet</small>
    </div>
  );
}

export function ApplicationEnd() {
  return (
    <>
      <p className="mt-6 mb-0 text-[13.5px] text-muted-foreground">
        Voluntary self-identification <span className="ml-1.5 text-faint">Optional, never shown to your team</span>
      </p>
      <span className="mt-5 inline-grid h-10 place-items-center rounded-full bg-foreground px-[18px] text-[14px] font-medium text-background opacity-85">
        Submit application
      </span>
    </>
  );
}

const ABOUT_YOU = new Set<clientTools.QuestionType>(["name", "email", "phone", "linkedin"]);

/** The application's sections, as the public form lays them out. */
export function applicationSections<T extends { type: clientTools.QuestionType }>(questions: T[]): { resume: T[]; about: T[]; rest: T[] } {
  return {
    resume: questions.filter((q) => q.type === "resume"),
    about: questions.filter((q) => ABOUT_YOU.has(q.type)),
    rest: questions.filter((q) => q.type !== "resume" && !ABOUT_YOU.has(q.type)),
  };
}

/** design/tats's application tab: the resume as a drop box, About you as a two-column grid, then the post's other questions. */
export function Application({ questions }: { questions: clientTools.Question[] }) {
  const { resume, about, rest } = applicationSections(questions);
  return (
    <div className="text-[14px] leading-[1.55]">
      {resume.map((q) => (
        <div key={q.questionId}>
          <h3 className={sheetHeading}>
            {q.label}
            <Req on={q.required} />
          </h3>
          <ResumeBox />
        </div>
      ))}
      {about.length ? (
        <>
          <h3 className={sheetHeading}>About you</h3>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {about.map((q) => (
              <div key={q.questionId} className="flex flex-col gap-1.5 text-[13px]">
                <span>
                  {q.label}
                  <Req on={q.required} />
                </span>
                <span className={answerBox} />
              </div>
            ))}
          </div>
        </>
      ) : null}
      {rest.length ? (
        <>
          <h3 className={sheetHeading}>Questions</h3>
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
      <ApplicationEnd />
    </div>
  );
}

/** The post's text: paragraphs, and headed lists (lib/public/post-text.ts). Plain text, never markup. */
export function PostBody({ text }: { text: string | null }) {
  return (
    <div className="text-[14px] leading-[1.7] text-foreground/85">
      {parsePostText(text).map((b, i) =>
        b.kind === "text" ? (
          <p key={i} className="m-0 mb-3.5 whitespace-pre-line [overflow-wrap:anywhere]">
            {b.text}
          </p>
        ) : (
          <div key={i} className="mb-3.5">
            {b.heading ? <h3 className="m-0 mt-7 mb-2.5 text-[14.5px] font-medium text-foreground">{b.heading}</h3> : null}
            <ul className="m-0 list-none p-0">
              {b.lines.map((l, n) => (
                <li key={n} className="flex items-start gap-2.5 py-[3px] [overflow-wrap:anywhere]">
                  <span className="mt-[9px] size-[5px] flex-none bg-[color:var(--faint)]" />
                  {l}
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}

/** design/tats's status chip: an 8px dot and the post's state. */
export function StatusChip({ accepting, label }: { accepting: boolean; label: string }) {
  return (
    <span
      className="inline-flex h-7 items-center gap-[7px] rounded-full border border-[color:var(--line)] px-2.5 text-[13px] whitespace-nowrap"
      title={accepting ? "Shown on the careers page" : "Not on the careers page"}
    >
      <i className={cn("inline-block size-2 flex-none rounded-full", accepting ? "bg-[color:var(--green)]" : "bg-[color:var(--faint)]")} />
      {label}
    </span>
  );
}

export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[color:var(--line)] py-3 text-[13px] first:pt-0">
      <b className="text-[12.5px] font-semibold">{label}</b>
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

export function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function postState(post: { status: clientTools.JobPostStatus; accepting: boolean }): string {
  return post.status === "live" ? (post.accepting ? "Live" : "Live, not taking applications") : post.status === "draft" ? "Draft" : "Closed";
}
