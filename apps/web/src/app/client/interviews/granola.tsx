import Link from "next/link";
import type * as React from "react";
import type { Db } from "@tacit/db";
import { Empty, Pill, textLink } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { readGranolaNotes, type GranolaReading } from "@/lib/client/granola-notes";
import { granolaHref, granolaText, granolaTranscript, matchedLine, type GranolaSection } from "@/lib/client/interview-granola";
import type { AccessLevel } from "@/lib/client/session";
import { cn } from "@/lib/utils";

// The member's own Granola notes on an interview they ran, the reader's last
// section. Granola is another company's server, so page.tsx streams this behind
// a Suspense boundary and the rest of the reader never waits on it. Everything
// from Granola is the candidate's and the interviewers' words and can say
// anything, so it stays fenced: `Fenced` is the only way out of here, plain
// React text in a marked block, never markup, a link or an attribute.
// design/tats shows a question-by-question breakdown with timestamps here; that
// was sample data, and Granola's text has no such fields.

/** Granola's text, set apart from the page's own by a rule down its left (or, for the transcript, a well), and never parsed into anything but plain text. Read as prose, in Mona Sans. */
function Fenced({ label, className, children }: { label: string; className?: string; children: string }) {
  return (
    <div
      data-untrusted={label}
      className={cn("m-0 border-l-2 border-[color:var(--line-strong)] py-0.5 pl-3.5 font-sans text-[14px] leading-[22px] break-words whitespace-pre-wrap", className)}
    >
      {children}
    </div>
  );
}

function Sections({ sections, label }: { sections: GranolaSection[]; label: string }) {
  return sections.map((s, i) => (
    <div key={i} className="grid gap-1.5">
      {s.label ? <b className="text-[12.5px] font-medium text-muted-foreground">{s.label}</b> : null}
      <Fenced label={label}>{s.text}</Fenced>
    </div>
  ));
}

/** The reader's last part, under a hairline like the others: its heading, then a tag saying whose these are; how the meeting was matched is the tag's hover. */
function Frame({ children, line }: { children: React.ReactNode; line?: string | null }) {
  return (
    <section aria-label="Your Granola notes" className="grid min-w-0 gap-4 border-t border-[color:var(--line)] px-4 pt-4 pb-6 @2xl:px-6">
      <div className="flex min-h-[30px] flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 font-sans text-[15px] leading-[22px] font-semibold tracking-[-0.01em]">Your Granola notes</h2>
        <Pill title={line ?? undefined}>
          Only you see these
          {line ? <span className="sr-only">. {line}</span> : null}
        </Pill>
      </div>
      {children}
    </section>
  );
}

const INTEGRATIONS = "/client/settings#granola";

export function GranolaLoading() {
  return (
    <Frame>
      <Empty className="my-0">Reading Granola…</Empty>
    </Frame>
  );
}

export function GranolaPanel({
  reading,
  interviewId,
  noteId,
  base,
}: {
  reading: GranolaReading;
  interviewId: string;
  /** Where its links go: the page's route, or Home's tab. */
  base?: string;
  /** The meeting the member picked (`?note=`), kept across the transcript's link. */
  noteId?: string;
}) {
  if (reading.status === "not_connected" || reading.status === "reconnect") {
    return (
      <Frame>
        <Empty className="my-0">
          {reading.status === "reconnect" ? "Granola no longer accepts Tacit's access. " : "Connect Granola to read your notes from this interview here. "}
          <Link href={INTEGRATIONS} className={textLink}>
            {reading.status === "reconnect" ? "Connect again" : "Integrations"}
          </Link>
        </Empty>
      </Frame>
    );
  }
  if (reading.status === "unavailable") {
    return (
      <Frame>
        <Empty className="my-0">{reading.message}</Empty>
      </Frame>
    );
  }
  if (reading.status === "no_match") {
    return (
      <Frame>
        <Empty className="my-0">
          {reading.nearby.length ? "No Granola meeting of yours matched this interview. These were around then:" : "You have no Granola meetings from around this interview."}
        </Empty>
        {reading.nearby.length ? (
          <ul className="m-0 grid list-none overflow-hidden rounded-[10px] p-0 shadow-[inset_0_0_0_1px_var(--line)]">
            {reading.nearby.map((n) => {
              const meeting = granolaText(n.excerpt);
              const named = [meeting.title, meeting.date].filter((t): t is string => !!t);
              return (
                <li key={n.noteId} className="flex min-h-12 items-center justify-between gap-3 border-t border-[color:var(--line)] py-2 pr-2 pl-4 first:border-t-0">
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
                    {named.length ? (
                      named.map((t, i) => (
                        <Fenced key={i} label="granola meeting" className={cn("min-w-0 border-l-0 pl-0 font-mono text-[13px] leading-5", i > 0 && "text-faint")}>
                          {t}
                        </Fenced>
                      ))
                    ) : (
                      <Fenced label="granola meeting" className="min-w-0 border-l-0 pl-0 font-mono text-[13px] leading-5">
                        {meeting.sections[0]?.text || "A meeting with no title"}
                      </Fenced>
                    )}
                  </span>
                  <Link href={granolaHref(interviewId, { note: n.noteId }, base)} className={buttonVariants({ variant: "outline", size: "sm" })} prefetch={false}>
                    Use this one
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Frame>
    );
  }

  const notes = granolaText(reading.notes);
  const transcript = granolaTranscript(reading.transcript);
  // A transcript that is only Granola's wrapper has nothing to show.
  const noTranscript = reading.transcriptStatus === "unavailable" || (reading.transcriptStatus === "included" && !transcript);
  return (
    <Frame line={matchedLine(reading.matchedBy)}>
      {notes.title ? (
        <Fenced label="granola notes" className="border-l-0 pl-0 text-[15px] font-semibold">
          {notes.title}
        </Fenced>
      ) : null}
      {notes.sections.length ? <Sections sections={notes.sections} label="granola notes" /> : <Empty className="my-0">Granola has no notes on this meeting.</Empty>}
      {reading.transcriptStatus === "not_requested" ? (
        <Link href={granolaHref(interviewId, { note: noteId, transcript: true }, base)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "justify-self-start")} prefetch={false}>
          Show the transcript
        </Link>
      ) : null}
      {noTranscript ? (
        <Empty className="my-0">Granola has no transcript of this one for you. Transcripts need a paid Granola plan.</Empty>
      ) : null}
      {reading.transcriptStatus === "included" && transcript ? (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <b className="text-[12.5px] font-medium text-muted-foreground">Transcript</b>
            <Link href={granolaHref(interviewId, { note: noteId }, base)} className={buttonVariants({ variant: "ghost", size: "sm" })} prefetch={false}>
              Hide
            </Link>
          </div>
          {/* A scrolling region needs focus to scroll by keyboard. */}
          <div tabIndex={0} role="region" aria-label="Transcript" className="max-h-[480px] overflow-y-auto rounded-[10px] bg-[color:var(--soft)] p-4 shadow-[inset_0_0_0_1px_var(--line)]">
            <Fenced label="granola transcript" className="border-l-0 pl-0">{transcript}</Fenced>
          </div>
        </div>
      ) : null}
      {reading.truncated ? <p className="m-0 text-[12px] text-faint">Cut for length. The whole of it is in Granola.</p> : null}
    </Frame>
  );
}

/** Reads and renders, behind page.tsx's Suspense boundary. A Granola outage comes back as a reading, so it is one sentence here and never the page's error. */
export async function GranolaNotes({
  db,
  accessLevel,
  interviewId,
  noteId,
  transcript,
  base,
}: {
  db: Db;
  accessLevel: AccessLevel;
  interviewId: string;
  noteId?: string;
  transcript: boolean;
  base?: string;
}) {
  const reading = await readGranolaNotes({ db, accessLevel }, { interviewId, noteId, includeTranscript: transcript });
  return <GranolaPanel reading={reading} interviewId={interviewId} noteId={noteId} base={base} />;
}
