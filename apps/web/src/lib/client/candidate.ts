import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { ClientContext } from "./session";

// One candidate for the candidate page, on the member's OWN client (never a
// privileged one): the client connector's own get_candidate and get_activity
// (@tacit-ats/core's clientTools), so the page and the connector agree on
// what a member may read. An interviewer gets what those give them: the
// five-field card, the resume, their own notes and their interviews of this
// candidate. What the tools do not carry is each job's owner, read here on
// the same client.

export type CandidateRead = {
  candidate: clientTools.CandidateDetail;
  activity: clientTools.ActivityEntry[];
  /** Each application's owner by application id; empty for an interviewer. */
  owners: Map<string, string | null>;
};

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

/** The candidate, or null when there is nobody by that id the member can see. */
export async function readCandidate(db: Db, ctx: clientTools.ClientToolCtx, candidateId: string): Promise<CandidateRead | null> {
  if (!UUID.test(candidateId)) return null;
  try {
    const candidate = await clientTools.getCandidate(db, ctx, candidateId);
    const [activity, owners] = await Promise.all([
      clientTools.getActivity(db, ctx, { candidateId, limit: clientTools.LIST_MAX }),
      ownersOf(db, candidate.applications.map((a) => a.applicationId)),
    ]);
    return { candidate, activity: activity.entries, owners };
  } catch (e) {
    if (e instanceof clientTools.ClientToolError && e.code === "not_found") return null;
    throw e;
  }
}
