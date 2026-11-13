import type { clientTools } from "@tacit-ats/core";
import { cn } from "@/lib/utils";
import { Marked } from "@/components/marked";
import { StatusGlyph, type GlyphKind } from "@/components/page";
import { parsePostText } from "@/lib/public/post-text";

// The pieces of design/tats's posting sheet, shared by the read-only post
// (view.tsx) and the editor's Preview (../../editor.tsx), so "Preview as
// applicant" draws what the post itself draws. Props only. In Testbench's
// voices: the post's text is prose a person wrote, so it reads in Mona Sans;
// the application is a form, so its labels are Geist Mono like every field's.

/** A field as the applicant will see it, drawn and not live: a field's shape on the surface, so it does not ask to be typed in. */
export const answerBox = "block h-9 rounded-[7px] bg-[color:var(--surface)] shadow-[inset_0_0_0_1px_var(--line-strong)]";
/** A heading in the sheet (What you'll do, About you, Questions): Mona Sans, as Testbench's card headings. */
export const sheetHeading = "m-0 mt-8 mb-3 flex gap-0.5 font-sans text-[15px] leading-[22px] font-semibold tracking-[-0.01em] text-foreground first:mt-0";
/** A field's label on the application: Geist Mono 13px, 500, as Testbench's form labels. */
export const fieldLabel = "font-mono text-[13px] leading-[18px] font-medium text-foreground";

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
          <i key={v} className="inline-grid h-8 place-items-center rounded-[7px] px-4 text-[13px] text-muted-foreground not-italic shadow-[inset_0_0_0_1px_var(--line-strong)]">
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
          <i key={o} className="inline-flex h-[26px] items-center rounded-[6px] px-[9px] text-[12.5px] text-muted-foreground not-italic shadow-[inset_0_0_0_1px_var(--line-strong)]">
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
    <div className="flex flex-col items-center gap-1 rounded-[10px] border-[1.5px] border-dashed border-[color:var(--line-strong)] bg-[color:var(--surface)] p-6 text-[13px] text-muted-foreground">
      <svg viewBox="0 0 16 16" className="mb-1 size-[18px] fill-none stroke-current text-faint [stroke-width:1.5] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden>
        <path d="M4 1.75h5.5L12.5 4.75v9.5h-8.5z M9.25 1.75v3.25h3.25" />
      </svg>
      <b className="font-medium text-foreground">Drop your resume or browse</b>
      <small className="text-[12px] text-faint">PDF, Word, text, PNG or JPEG, up to 3 MB</small>
    </div>
  );
}

export function ApplicationEnd() {
  return (
    <>
      <p className="mt-7 mb-0 flex flex-wrap gap-x-3 text-[13px] text-muted-foreground">
        <span>Voluntary self-identification</span>
        <span className="text-faint">Optional, never shown to your team</span>
      </p>
      {/* Drawn, not pressable: the applicant's button, as the public form shows it. */}
      <span aria-hidden className="mt-5 inline-grid h-9 cursor-default place-items-center rounded-[7px] bg-primary px-3.5 font-mono text-[13px] font-medium text-primary-foreground opacity-85">
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
    <div className="text-[13px]">
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
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            {about.map((q) => (
              <div key={q.questionId} className="flex flex-col gap-1.5">
                <span className={fieldLabel}>
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
            <div key={q.questionId} className="border-b border-[color:var(--line)] py-4 first-of-type:pt-1">
              <div className={cn(fieldLabel, "mb-2.5 flex items-start gap-0.5")}>
                <span>
                  <Marked text={q.label} />
                </span>
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

/** The post's text: paragraphs, and headed lists (lib/public/post-text.ts). Plain text, never markup; prose, so Mona Sans. */
export function PostBody({ text }: { text: string | null }) {
  return (
    <div className="max-w-[680px] font-sans text-[14px] leading-[22px] text-muted-foreground">
      {parsePostText(text).map((b, i) =>
        b.kind === "text" ? (
          <p key={i} className="m-0 mb-4 whitespace-pre-line [overflow-wrap:anywhere] first:text-[17px] first:leading-[26px] first:tracking-[-0.01em] first:text-foreground">
            {b.text}
          </p>
        ) : (
          <div key={i} className="mb-4">
            {b.heading ? <h3 className={cn(sheetHeading, "first:mt-8")}>{b.heading}</h3> : null}
            <ul className="m-0 list-none p-0">
              {b.lines.map((l, n) => (
                <li key={n} className="flex items-start gap-3 py-[3px] [overflow-wrap:anywhere]">
                  <span aria-hidden className="mt-[9px] size-[5px] flex-none rounded-[1px] bg-[color:var(--ink-4)]" />
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

/** Which of Testbench's square glyphs a post's state takes: live while it takes applications, dashed while published on a job that is not open, crossed once closed, an empty frame for a draft or no post. */
function postGlyph(accepting: boolean, label: string): GlyphKind {
  if (accepting) return "live";
  if (label.startsWith("Live")) return "lapsed";
  return label === "Closed" ? "closed" : "empty";
}

/** The post's state as a Testbench tag: its square glyph and the state, outlined, colour only in the glyph while it is live. */
export function StatusChip({ accepting, label }: { accepting: boolean; label: string }) {
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 rounded-[6px] px-2 font-mono text-[12px] leading-none font-medium whitespace-nowrap text-foreground shadow-[inset_0_0_0_1px_var(--line-strong)]"
      title={accepting ? "Shown on the careers page" : "Not on the careers page"}
    >
      <StatusGlyph kind={postGlyph(accepting, label)} className="size-3" />
      {label}
    </span>
  );
}

/** One fact down the sheet's left: its label in Geist Mono 500, the value under it, a hairline between. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-[color:var(--line)] py-3.5 text-[13px] first:pt-0 last:border-b-0">
      <b className={fieldLabel}>{label}</b>
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

/** The sheet's Overview / Application tabs, Testbench's underlined tabs (its review's): Geist Mono, the picked one in ink over a 2px rule. */
export const SHEET_TABS = { overview: "Overview", application: "Application" } as const;
export const sheetTab = (picked: boolean) =>
  cn(
    "-mb-px inline-flex h-9 items-center border-b-2 font-mono text-[13px] transition-colors duration-150",
    picked ? "border-[color:var(--ink)] font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
  );

/** The sheet itself: one white card, the post as an applicant reads it. */
export const sheetCard = "rounded-[14px] bg-card px-5 py-6 shadow-[var(--shadow)] sm:px-10 sm:pt-9 sm:pb-11";
/** The post's title at the top of the sheet: Mona Sans, the biggest name on the page. */
export const sheetTitle = "m-0 font-sans text-[28px] leading-[34px] font-semibold tracking-[-0.025em] sm:text-[34px] sm:leading-[40px]";
