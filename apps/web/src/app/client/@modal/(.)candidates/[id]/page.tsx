import { resolveClient } from "@/lib/client/session";
import { readCandidateView } from "../../../candidates/[id]/read";
import { CandidateBody } from "../../../candidates/[id]/view";
import { CandidatePopup } from "./popup";

// A candidate, opened from anywhere in the client area: over the page you were
// on, not in place of it, so the list you were walking is still there when it
// closes. Next intercepts the link (`(.)candidates/[id]`); the address is the
// candidate's own, so a reload, a shared link or "Open as a page" gives the full
// page (candidates/[id]/page.tsx), which keeps every control.
//
// It draws what the Pipeline's pop-up draws: the dashboard, read at a glance,
// with the side card of quick facts (application, contact, files) on the right.
// Read on the member's own token, through the same readCandidateView. Someone
// they cannot see, or a refused sign-in, shows nothing here: the page itself
// says why.

export default async function CandidateOver({ params }: { params: Promise<{ id: string }> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return null;
  const { id } = await params;
  const read = await readCandidateView(gate.ctx, id, Date.now());
  if (!read) return null;
  return (
    <CandidatePopup id={id} title={read.candidate.name?.trim() || "Unnamed"}>
      <CandidateBody {...read} notice={null} error={null} dashboard journey={null} />
    </CandidatePopup>
  );
}
