import Link from "next/link";
import type * as React from "react";
import type { Db } from "@tacit/db";
import { Empty } from "@/components/page";
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

/** Granola's text, set apart from the page's own and never parsed into anything but plain text. */
function Fenced({ label, className, children }: { label: string; className?: string; children: string }) {
  return (
    <div
      data-untrusted={label}
      className={cn("m-0 border-l-2 border-[color:var(--line-strong)] py-0.5 pl-3.5 text-[14px] leading-normal break-words whitespace-pre-wrap", className)}
    >
      {children}
    </div>
  );
}

function Sections({ sections, label }: { sections: GranolaSection[]; label: string }) {
  return sections.map((s, i) => (
    <div key={i} className="grid gap-1.5">
      {s.label ? <b className="text-[13px] font-medium text-muted-foreground">{s.label}</b> : null}
      <Fenced label={label}>{s.text}</Fenced>
    </div>
  ));
}

function Frame({ children, line }: { children: React.ReactNode; line?: string | null }) {
  return (
    <section aria-label="Your Granola notes" className="grid gap-3.5 border-t border-[color:var(--line)] px-4 pt-5 pb-[22px] @2xl:px-[26px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[14.5px]">
        <b className="font-medium">Your Granola notes</b>
        <span className="text-[13px] text-faint">{line ? `${line} · ` : null}Only you see these</span>
      </div>
      {children}
    </section>
  );
}

const INTEGRATIONS = "/client/settings#granola";
const quiet = "text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground";

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
          <Link href={INTEGRATIONS} className={quiet}>
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
          <ul className="m-0 grid list-none gap-2 p-0">
            {reading.nearby.map((n) => {
              const meeting = granolaText(n.excerpt);
              return (
                <li key={n.noteId} className="flex items-baseline justify-between gap-3 border-t border-[color:var(--line)] pt-2 first:border-t-0 first:pt-0">
                  <Fenced label="granola meeting" className="min-w-0 flex-1 border-l-0 pl-0 text-[13.5px]">
                    {[meeting.title, meeting.date].filter(Boolean).join(" · ") || meeting.sections[0]?.text || "A meeting with no title"}
                  </Fenced>
                  <Link href={granolaHref(interviewId, { note: n.noteId }, base)} className={cn(quiet, "flex-none")} prefetch={false}>
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
        <Fenced label="granola notes" className="border-l-0 pl-0 font-medium">
          {notes.title}
        </Fenced>
      ) : null}
      {notes.sections.length ? <Sections sections={notes.sections} label="granola notes" /> : <Empty className="my-0">Granola has no notes on this meeting.</Empty>}
      {reading.transcriptStatus === "not_requested" ? (
        <Link href={granolaHref(interviewId, { note: noteId, transcript: true }, base)} className={cn(quiet, "justify-self-start")} prefetch={false}>
          Show the transcript
        </Link>
      ) : null}
      {noTranscript ? (
        <Empty className="my-0">Granola has no transcript of this one for you. Transcripts need a paid Granola plan.</Empty>
      ) : null}
      {reading.transcriptStatus === "included" && transcript ? (
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <b className="text-[13px] font-medium text-muted-foreground">Transcript</b>
            <Link href={granolaHref(interviewId, { note: noteId }, base)} className={quiet} prefetch={false}>
              Hide
            </Link>
          </div>
          {/* A scrolling region needs focus to scroll by keyboard. */}
          <div tabIndex={0} role="region" aria-label="Transcript" className="max-h-[480px] overflow-y-auto">
            <Fenced label="granola transcript">{transcript}</Fenced>
          </div>
        </div>
      ) : null}
      {reading.truncated ? <p className="m-0 text-xs text-faint">Cut for length. The whole of it is in Granola.</p> : null}
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
