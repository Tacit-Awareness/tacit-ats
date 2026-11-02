import { clientTools } from "@tacit-ats/core";
import Link from "next/link";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { RESUME_ACCEPT, readAddForm } from "@/lib/client/referrals";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../refusal";
import { addReferralAction } from "../actions";
import { REFERRAL_ERRORS, isReferralError } from "../messages";
import { AddReferralView } from "./view";

// "Add referral" (design/tats's referral form): the open jobs the member may
// add people to and the team's names, read on their own token
// (lib/client/referrals.ts's readAddForm). The action checks again, and the
// policies after it.

export default async function ClientAddReferral({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, accessLevel } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar crumbs={[{ href: "/client/referrals", label: "Referrals" }]} title="Add referral" />}>
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
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const { jobs, teammates } = await readAddForm(db);
  return <AddReferralView action={addReferralAction} jobs={jobs} teammates={teammates} error={isReferralError(error) ? REFERRAL_ERRORS[error] : null} resumeMaxBytes={clientTools.FILE_MAX_BYTES} resumeAccept={RESUME_ACCEPT} />;
}
