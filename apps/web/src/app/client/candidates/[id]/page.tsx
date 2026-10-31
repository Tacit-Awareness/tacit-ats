import { notFound } from "next/navigation";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../refusal";
import { readCandidateView } from "./read";
import { CANDIDATE_ERRORS, CANDIDATE_NOTICES, isCandidateError, isCandidateNotice } from "./messages";
import { CandidateView } from "./view";

// One candidate, read with the signed-in member's own token through the
// client connector's get_candidate and get_activity (lib/client/candidate.ts),
// so what shows is what the policies let them read: the whole record for an
// admin or the hiring team, an interviewer's own interviews and notes. Under
// each job the member may edit (can_on_role 'can_edit_pipeline', asked by
// lib/client/candidate-edits.ts's readEditing) come its controls; actions.ts
// does the writes and answers with a code (messages.ts). Anyone who can open
// the page can leave a note (note-composer.tsx). Nobody by that id they can
// see is a 404, the same as no such candidate.

export default async function ClientCandidate({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { id } = await params;
  const read = await readCandidateView(gate.ctx, id, Date.now());
  if (!read) notFound();

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const notice = one(sp.notice);
  const error = one(sp.error);

  return (
    <CandidateView {...read} notice={isCandidateNotice(notice) ? CANDIDATE_NOTICES[notice] : null} error={isCandidateError(error) ? CANDIDATE_ERRORS[error] : null} />
  );
}
