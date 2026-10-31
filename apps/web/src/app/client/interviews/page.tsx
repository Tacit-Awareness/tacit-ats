import { Suspense } from "react";
import { clientTools } from "@tacit-ats/core";
import { granolaReadable } from "@/lib/client/interview-granola";
import { GROUPS, RECOMMENDATION_LABEL, groupInterviews, verdictOf, type Recommendation, type Verdict } from "@/lib/client/interview-groups";
import { hiddenOn, loopRounds, stageIsOpen } from "@/lib/client/interview-loop";
import { readReviewed } from "@/lib/client/interview-reviews";
import { readInterview, readInterviews, type InterviewDetail, type InterviewListItem, type Member } from "@/lib/client/interviews";
import { ago, until } from "@/lib/client/pipeline-columns";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { GranolaLoading, GranolaNotes } from "./granola";
import { InterviewsView, type ListGroup, type Reader } from "./view";

// design/tats's Interviews: every interview the member can see, Upcoming and
// then the past ones by how they went, and a reader with the candidate's loop
// and this interview's feedback. Read with the signed-in member's own token
// (lib/client/interviews.ts), so an interviewer sees their own interviews and
// the feedback the org's feedback_visibility lets them read. Feedback is filed
// from the client connector (submit_feedback); the page's one write is the
// member's own reviewed check (review.tsx, which saves through review/route.ts).
// On an interview the member ran, their own Granola notes stream in below the
// rest (./granola.tsx): `?note=` is the meeting they picked when nothing matched,
// `?transcript=1` asks for the transcript too, both read from the URL like `?i=`.

const href = (id: string) => `/client/interviews?i=${encodeURIComponent(id)}`;
const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
const isPast = (i: InterviewListItem, now: number) => i.status !== "scheduled" || Date.parse(i.endsAt) < now;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const whoRan = (names: string[]) => (names.length > 1 ? `${names[0]} +${names.length - 1}` : (names[0] ?? null));
const when = (i: InterviewListItem, now: number) => (isPast(i, now) ? ago(i.startsAt, now) : until(i.startsAt, now));

function buildReader(item: InterviewListItem, detail: InterviewDetail, stillOpen: boolean, listed: ReadonlySet<string>, member: Member, now: number): Reader {
  const progress = detail.plan.candidate!;
  const rounds = loopRounds(progress, item.interviewId, listed, now, stillOpen).map(({ interviewId, ...r }) => ({ ...r, href: interviewId ? href(interviewId) : null }));
  const current = rounds.find((r) => r.place === "current");
  const held = rounds.filter((r) => r.status === "Held").length;
  const candidate = item.candidateName ?? "Candidate";

  const feedback = detail.feedback.feedback.map((f) => ({
    feedbackId: f.feedbackId,
    interviewer: f.mine ? "You" : (f.interviewer ?? "Someone"),
    recommendation: RECOMMENDATION_LABEL[f.recommendation as Recommendation] ?? f.recommendation,
    verdict: verdictOf([f.recommendation]),
    rating: f.rating,
    submitted: `Filed ${ago(f.submittedAt, now)}`,
    ratings: f.ratings.map((r) => ({ attribute: r.attribute ?? "Scorecard item", rating: r.rating, note: r.note })),
    notes: f.notes,
  }));
  const hidden = hiddenOn(progress, item.interviewId);
  const notes = [
    detail.feedback.yoursOutstanding && member.accessLevel !== "admin" ? "Others' feedback may stay hidden until you file yours." : null,
    hidden ? `${hidden === 1 ? "One interviewer's" : `${hidden} interviewers'`} feedback is not visible to you.` : null,
  ].filter(Boolean);

  return {
    title: `${candidate} · ${item.step ?? "Interview"}`,
    sub: [item.jobTitle, item.interviewers.join(", "), when(item, now)].filter(Boolean).join(" · "),
    verdict: isPast(item, now) ? verdictOf(item.recommendations) : null,
    candidate,
    tag: current ? `Round ${current.n} of ${rounds.length}` : `${rounds.length} rounds`,
    loopLine: `${detail.plan.title} · ${held} of ${rounds.length} ${rounds.length === 1 ? "round" : "rounds"} held`,
    rounds,
    partial: !progress.seesAllInterviews,
    feedback,
    feedbackNote: notes.length ? notes.join(" ") : null,
  };
}

export default async function ClientInterviews({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;
  const member: Member = { actorId, orgId: org.id, accessLevel };

  const sp = await searchParams;
  const asked = first(sp.i);
  const now = new Date();
  const nowMs = now.getTime();

  const items = await readInterviews(db, member, now, asked);
  const grouped = groupInterviews(items, nowMs);
  const ordered = grouped.flatMap((g) => g.items);
  // Nothing picked: the reader shows the first one beside the list; on a phone the list alone.
  const selected = ordered.find((i) => i.interviewId === asked) ?? ordered[0] ?? null;
  const listed = new Set(ordered.map((i) => i.interviewId));

  let reader: Reader | null = null;
  let readerError: string | null = null;
  if (selected) {
    try {
      // Only "Up next" hangs on the stage, so a failed or refused read just shows none.
      const [detail, application] = await Promise.all([
        readInterview(db, member, selected),
        db.from("applications").select("stage").eq("id", selected.applicationId).maybeSingle(),
      ]);
      reader = buildReader(selected, detail, stageIsOpen(application.data?.stage), listed, member, nowMs);
    } catch (err) {
      if (!(err instanceof clientTools.ClientToolError)) throw err;
      readerError = "This interview is no longer there for you to read.";
    }
  }

  // `?note=` belongs to the interview it was picked on, and a malformed one is ignored rather than refused.
  const note = first(sp.note);
  const noteId = selected?.interviewId === asked && clientTools.GRANOLA_NOTE_ID.test(note) ? note : undefined;
  const transcript = first(sp.transcript) === "1";
  const granola =
    selected && granolaReadable(selected, nowMs) ? (
      <Suspense key={`${selected.interviewId}:${noteId ?? ""}:${transcript}`} fallback={<GranolaLoading />}>
        <GranolaNotes db={db} accessLevel={accessLevel} interviewId={selected.interviewId} noteId={noteId} transcript={transcript} />
      </Suspense>
    ) : null;

  // A check is a convenience: if it cannot be read the page still does its job, without them.
  const past = grouped.filter((g) => g.key !== "upcoming").flatMap((g) => g.items.map((i) => i.interviewId));
  const reviewed = await readReviewed(db, actorId, past).then(
    (ids) => [...ids],
    (err: unknown) => {
      console.error("[client-interviews] reviewed read failed:", err instanceof Error ? err.message : "read failed");
      return null;
    },
  );

  const groups: ListGroup[] = grouped.map((g) => ({
    key: g.key,
    label: g.label,
    rows: g.items.map((i) => ({
      interviewId: i.interviewId,
      href: href(i.interviewId),
      candidate: i.candidateName ?? "Candidate",
      // design/tats's "Round · interviewer · date"; the date stays relative (no time zone on the server).
      line: [i.step ?? "Interview", whoRan(i.interviewers), when(i, nowMs)].filter(Boolean).join(" · "),
      when: when(i, nowMs),
      whenTitle: utc(i.startsAt),
      verdict: g.key === "upcoming" ? null : (g.key as Verdict),
      selected: selected?.interviewId === i.interviewId,
    })),
  }));
  const counts = GROUPS.filter((g) => g.key !== "upcoming").map((g) => ({
    verdict: g.key as Verdict,
    n: grouped.find((x) => x.key === g.key)?.items.length ?? 0,
  }));

  return (
    <InterviewsView
      groups={groups}
      counts={counts}
      reviewed={reviewed}
      reader={reader}
      granola={granola}
      open={!!asked && selected?.interviewId === asked}
      readerError={readerError}
    />
  );
}
