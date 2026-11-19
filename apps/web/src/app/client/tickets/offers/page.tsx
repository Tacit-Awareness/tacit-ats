import Link from "next/link";
import { clientTools } from "@tacit-ats/core";
import { FlashToast } from "@/components/flash-toast";
import { Notice, Page, PageBar, Section, textLink } from "@/components/page";
import { departmentScope, inScope } from "@/lib/client/department-tree";
import { readDepartments } from "@/lib/client/departments";
import { readOfferList, type OfferRow } from "@/lib/client/offer-list";
import { OFFER_GROUPS, groupOf } from "@/lib/client/offer-page-rules";
import { readPipeline } from "@/lib/client/pipeline";
import { resolveClient } from "@/lib/client/session";
import { INBOX_ERRORS, INBOX_NOTICES, isInboxError, isInboxNotice } from "../../inbox/messages";
import { Refusal } from "../../refusal";
import { OfferView } from "./view";

// Offers (design/tacit-tickets's Offers), under Tickets: an offer has its own
// page. The queue on the left (Needs Your Sign-Off, Drafts, Extended, Closed),
// the offer in the middle with the one next step in the bar under it, and the
// terms and the sign-off steps on the right. Read on the member's own token
// (lib/client/offer-list.ts: core's getOffers through the candidate page's
// readOffers, and listMyApprovals), so only whoever may manage the job sees an
// offer; written through the candidate page's offer actions and the Inbox's
// approval decision (offers/bar.tsx).
// - `?o=<offer id>` picks one; `?i=appr-<request id>` (where the Inbox's
//   decision comes back to) picks the offer of that request.
// - `?department=`: a team's offers, by the job's department.
// The middle is the offer's terms as tATS records them, on a sheet: tATS has
// no offer letter, so the prototype's letter, its clauses and blanks, the
// shares, stock plan, pay period and address, Attachment A, DocuSign and "what
// would win them" are left out.

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ClientOffers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;
  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="Offers" />}>
        <Section>
          <p className="m-0 text-[13px] text-muted-foreground">
            You&apos;re an interviewer here. The people you interview are on your{" "}
            <Link href="/client" className={textLink}>
              home page
            </Link>
            .
          </p>
        </Section>
      </Page>
    );
  }

  const sp = await searchParams;
  const ctx: clientTools.ClientToolCtx = { actorId, orgId: org.id, accessLevel, source: "claude" };
  const [{ rows: all, capped }, pipeline, structure] = await Promise.all([readOfferList(db, ctx), readPipeline(db, new Date()), readDepartments(db)]);
  const scope = departmentScope(structure, one(sp.department));
  const team = scope.departmentId ? (scope.options.find((o) => o.id === scope.departmentId)?.name ?? null) : null;
  const inTeam = (r: OfferRow) => inScope(scope, r.jobId);
  const rows = all.filter(inTeam);
  const ordered = OFFER_GROUPS.flatMap((g) => rows.filter((r) => groupOf(r.offer, !!r.myRequestId) === g.key));
  const asked = one(sp.i).startsWith("appr-") ? one(sp.i).slice(5) : null;
  const sel = ordered.find((r) => r.offer.offerId === one(sp.o)) ?? (asked ? ordered.find((r) => r.offer.approval?.requestId === asked) : undefined) ?? ordered[0] ?? null;

  // Who could have one drafted: in process, at offer or the team's call, with no open or accepted offer.
  const busy = new Set(all.filter((r) => ["draft", "extended", "accepted"].includes(r.offer.status)).map((r) => r.applicationId));
  const candidates = pipeline.entries
    .filter((e) => (e.column === "offer" || e.column === "decide") && e.editable && !busy.has(e.applicationId) && inScope(scope, e.roleId))
    .map((e) => ({ candidateId: e.personId, applicationId: e.applicationId, name: e.personName }));

  const notice = one(sp.notice);
  const error = one(sp.error);
  const toast = isInboxNotice(notice) ? <FlashToast text={INBOX_NOTICES[notice]} /> : null;
  const flash = isInboxError(error) ? <Notice tone="error">{INBOX_ERRORS[error]}</Notice> : null;
  return (
    <>
      {toast}
      <OfferView org={org.name} team={team} rows={rows} sel={sel} departmentId={scope.departmentId} candidates={candidates} flash={flash} capped={capped} />
    </>
  );
}
