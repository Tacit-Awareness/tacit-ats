import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { Tone } from "@/components/tickets/tone";
import type { AccessLevel } from "./session";
import { closedTone, liveTone, wayOf, type Way } from "./home-tickets-rules";
import type { ColumnKey } from "./pipeline-columns";
import { readPipeline } from "./pipeline";

// Home's read (design/tacit-tickets's Home), on the member's OWN client (never a
// privileged one), so the map and the funnel count only what their token can
// read: an admin's org, a hiring-team member's jobs, an external recruiter's own
// adds. Two reads:
//
// - every application made since the start of the calendar year two years back
//   (so the day map can step back up to 24 months), with who and for which job,
//   for the map of days; the client puts each into a day in the member's own
//   time zone, which the server does not know;
// - the live applications, lib/client/pipeline.ts's readPipeline (the Pipeline's
//   own computed columns and core's `stalled`), plus core's listMyApprovals for
//   the offers waiting on this member, for the funnel.
//
// Not for interviewers (`limited`): Home keeps their own page.

const PAGE = 1000;
/** Applications the map reads at most; past it the heading says so. */
export const ARRIVALS_MAX = 10_000;

export type HomeArrival = {
  at: string;
  way: Way;
  personId: string;
  name: string;
  job: string;
  stage: string;
  tone: Tone;
};

export type HomeLive = {
  applicationId: string;
  personId: string;
  name: string;
  job: string;
  column: ColumnKey;
  stalled: string[];
  next: string | null;
  tone: Tone;
};

export type HomeTicketsRead = {
  /** The first day the map can show, YYYY-MM-DD. */
  from: string;
  arrivals: HomeArrival[];
  live: HomeLive[];
  /** A read stopped at its cap, so a number is a floor. */
  truncated: boolean;
};

type Row = { created_at: string; source: string; source_detail: string | null; stage: string; person_id: string; people: { display_name: string | null } | null; roles: { title: string } | null };

export async function readHomeTickets(db: Db, member: { actorId: string; orgId: string; accessLevel: AccessLevel }, now: Date): Promise<HomeTicketsRead> {
  // A day early, so a member east of UTC still gets their 1 January.
  const from = new Date(Date.UTC(now.getUTCFullYear() - 2, 0, 1) - 86_400_000).toISOString();
  // A read writes no audit row, so the source is never read.
  const ctx: clientTools.ClientToolCtx = { ...member, source: "claude" };
  const [pipeline, approvals, rows] = await Promise.all([readPipeline(db, now), clientTools.listMyApprovals(db, ctx), arrivals(db, from)]);

  const waiting = new Set(approvals.flatMap((a) => (a.kind === "offer" && a.applicationId ? [a.applicationId] : [])));
  const live: HomeLive[] = pipeline.entries.map((e) => ({
    applicationId: e.applicationId,
    personId: e.personId,
    name: e.personName,
    job: e.roleTitle,
    column: e.column,
    stalled: [...e.stalled],
    next: e.nextAction,
    tone: liveTone({ column: e.column, stalled: e.stalled, waitingOnMe: waiting.has(e.applicationId) }),
  }));
  const toneOf = new Map(live.map((l) => [l.personId, l.tone]));

  return {
    from: from.slice(0, 10),
    arrivals: rows.rows.map((r) => ({
      at: r.created_at,
      way: wayOf(r.source, r.source_detail),
      personId: r.person_id,
      name: r.people?.display_name ?? "Unnamed",
      job: r.roles?.title ?? "",
      stage: r.stage,
      tone: toneOf.get(r.person_id) ?? closedTone(r.stage),
    })),
    live,
    truncated: rows.truncated || pipeline.capped,
  };
}

async function arrivals(db: Db, from: string): Promise<{ rows: Row[]; truncated: boolean }> {
  const rows: Row[] = [];
  for (let at = 0; at < ARRIVALS_MAX; at += PAGE) {
    const { data, error } = await db
      .from("applications")
      .select("created_at, source, source_detail, stage, person_id, people(display_name), roles(title)")
      // A merged application is the same candidate counted twice: only live ones count.
      .is("merged_into_id", null)
      .gte("created_at", from)
      .order("created_at", { ascending: false })
      .order("id")
      .range(at, at + PAGE - 1)
      .overrideTypes<Row[], { merge: false }>();
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
