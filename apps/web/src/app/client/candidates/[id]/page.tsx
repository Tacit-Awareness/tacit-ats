import { notFound } from "next/navigation";
import { readCandidate, toolCtx } from "@/lib/client/candidate";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../refusal";
import { CandidateView } from "./view";

// One candidate, read with the signed-in member's own token through the
// client connector's get_candidate and get_activity (lib/client/candidate.ts),
// so what shows is what the policies let them read: the whole record for an
// admin or the hiring team, an interviewer's own interviews and notes.
// Read-only; the edit controls are on each job's board. Nobody by that id
// they can see is a 404, the same as no such candidate.

export default async function ClientCandidate({ params }: { params: Promise<{ id: string }> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { id } = await params;
  const read = await readCandidate(gate.ctx.db, toolCtx(gate.ctx), id);
  if (!read) notFound();

  return <CandidateView candidate={read.candidate} activity={read.activity} owners={Object.fromEntries(read.owners)} now={Date.now()} />;
}
