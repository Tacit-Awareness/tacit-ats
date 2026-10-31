import { readCandidate, toolCtx } from "@/lib/client/candidate";
import { readEditing, readLabelChoices } from "@/lib/client/candidate-edits";
import type { ClientContext } from "@/lib/client/session";
import type { CandidateViewProps } from "./view";

/** What the candidate page and the Pipeline's pop-up draw, on the member's own token. Null is nobody by that id they can see. */
export async function readCandidateView(member: ClientContext, candidateId: string, now: number): Promise<Omit<CandidateViewProps, "notice" | "error"> | null> {
  const read = await readCandidate(member.db, toolCtx(member), candidateId);
  if (!read) return null;
  // An interviewer edits nothing here, and their token reads no applications.
  const editing =
    member.accessLevel === "limited"
      ? null
      : await readEditing(
          member.db,
          read.candidate.applications.map((a) => a.applicationId),
        );
  const labels = member.accessLevel === "limited" ? null : await readLabelChoices(member.db, candidateId, read.candidate.tags);
  return {
    candidate: read.candidate,
    activity: read.activity,
    owners: Object.fromEntries(read.owners),
    past: read.past,
    editing: editing && editing.editable.size ? { apps: Object.fromEntries(editing.editable), owners: editing.owners, reasons: editing.reasons } : null,
    labels,
    now,
  };
}
