import { clientTools } from "@tacit-ats/core";
import { readCandidate, toolCtx } from "@/lib/client/candidate";
import { readEditing, readLabelChoices } from "@/lib/client/candidate-edits";
import { FILE_ACCEPT, FILE_EXTENSIONS } from "@/lib/client/candidate-files";
import { readOffers } from "@/lib/client/offers";
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
  const offers = await readOffers(member.db, toolCtx(member), read.candidate.applications.map((a) => a.applicationId));
  return {
    candidate: read.candidate,
    activity: read.activity,
    owners: Object.fromEntries(read.owners),
    past: read.past,
    editing: editing && editing.editable.size ? { apps: Object.fromEntries(editing.editable), owners: editing.owners, reasons: editing.reasons } : null,
    labels,
    offers,
    // can_edit_person, the check readLabelChoices just made and core's addFile makes again.
    upload: labels ? { accept: FILE_ACCEPT, extensions: FILE_EXTENSIONS, maxBytes: clientTools.FILE_MAX_BYTES } : null,
    now,
  };
}
