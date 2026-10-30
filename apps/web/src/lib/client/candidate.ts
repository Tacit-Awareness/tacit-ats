import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { isClosedStage, pastApplications, type PastApplication } from "./past-applications";
import type { ClientContext } from "./session";

// One candidate for the candidate page, on the member's OWN client (never a
// privileged one): the client connector's own get_candidate and get_activity
// (@tacit-ats/core's clientTools), so the page and the connector agree on
// what a member may read. An interviewer gets what those give them: the
// five-field card, the resume, their own notes and their interviews of this
// candidate. What the tools do not carry is each job's owner and when each
// application began and closed, read here on the same client.

export type CandidateRead = {
  candidate: clientTools.CandidateDetail;
  activity: clientTools.ActivityEntry[];
  /** Each application's owner by application id; empty for an interviewer. */
  owners: Map<string, string | null>;
  /** Applications closed before another began (lib/client/past-applications.ts); empty for an interviewer. */
  past: PastApplication[];
};

/** The most of the feed the page reads: the newest, across every kind of entry. */
export const FEED_MAX = clientTools.LIST_MAX;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tools' caller. Reads write no audit row, so `source` is never recorded. */
export const toolCtx = (ctx: Pick<ClientContext, "actorId" | "accessLevel" | "org">): clientTools.ClientToolCtx => ({
  actorId: ctx.actorId,
  orgId: ctx.org.id,
  accessLevel: ctx.accessLevel,
  source: "claude",
});

async function ownersOf(db: Db, applicationIds: string[]): Promise<Map<string, string | null>> {
  const owners = new Map<string, string | null>();
  if (!applicationIds.length) return owners;
  const { data: apps, error } = await db.from("applications").select("id, owner_actor_id").in("id", applicationIds);
  if (error) throw new Error(error.message);
  const ids = [...new Set((apps ?? []).map((a) => a.owner_actor_id).filter((id): id is string => !!id))];
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { data: members, error: membersError } = await db.from("org_members").select("id, display_name").in("id", ids);
    if (membersError) throw new Error(membersError.message);
    for (const m of members ?? []) if (m.id) names.set(m.id, m.display_name);
  }
  for (const a of apps ?? []) owners.set(a.id, a.owner_actor_id ? (names.get(a.owner_actor_id) ?? null) : null);
  return owners;
}

/** The applications they came back after. Never reads an event's text: only which stages it joined, and when. */
async function pastOf(db: Db, apps: clientTools.CandidateDetail["applications"]): Promise<PastApplication[]> {
  const closed = apps.filter((a) => isClosedStage(a.stage)).map((a) => a.applicationId);
  if (apps.length < 2 || !closed.length) return [];
  const [created, events] = await Promise.all([
    db.from("applications").select("id, created_at").in("id", apps.map((a) => a.applicationId)),
    db.from("application_events").select("application_id, from_stage, to_stage, created_at").in("application_id", closed).eq("kind", "stage_changed"),
  ]);
  if (created.error) throw new Error(created.error.message);
  if (events.error) throw new Error(events.error.message);
  const began = new Map((created.data ?? []).map((a) => [a.id, a.created_at]));
  return pastApplications(
    apps.flatMap((a) => {
      const createdAt = began.get(a.applicationId);
      return createdAt ? [{ ...a, createdAt }] : [];
    }),
    (events.data ?? []).map((e) => ({ applicationId: e.application_id, fromStage: e.from_stage, toStage: e.to_stage, at: e.created_at })),
  );
}

/** The candidate, or null when there is nobody by that id the member can see. */
export async function readCandidate(db: Db, ctx: clientTools.ClientToolCtx, candidateId: string): Promise<CandidateRead | null> {
  if (!UUID.test(candidateId)) return null;
  try {
    const candidate = await clientTools.getCandidate(db, ctx, candidateId);
    const [activity, owners, past] = await Promise.all([
      clientTools.getActivity(db, ctx, { candidateId, limit: FEED_MAX }),
      ownersOf(db, candidate.applications.map((a) => a.applicationId)),
      pastOf(db, candidate.applications),
    ]);
    return { candidate, activity: activity.entries, owners, past };
  } catch (e) {
    if (e instanceof clientTools.ClientToolError && e.code === "not_found") return null;
    throw e;
  }
}
