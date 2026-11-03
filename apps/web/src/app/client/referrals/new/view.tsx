import Link from "next/link";
import { Page, PageBar, Section, textLink } from "@/components/page";
import type { ReferralJob } from "@/lib/client/referrals";
import type { ReferralState } from "../messages";
import { ReferralForm } from "./referral-form";

// The "Add referral" page's markup, props only (page.tsx does the reads); the
// form itself is referral-form.tsx, which answers a refusal in place.

export function AddReferralView({
  action,
  jobs,
  teammates,
  resumeMaxBytes,
  resumeAccept,
}: {
  action: (prev: ReferralState, form: FormData) => Promise<ReferralState>;
  jobs: ReferralJob[];
  teammates: string[];
  resumeMaxBytes: number;
  resumeAccept: string;
}) {
  return (
    <Page narrow bar={<PageBar crumbs={[{ href: "/client/referrals", label: "Referrals" }]} title="Add referral" />}>
      <p className="m-0 text-[13px] text-muted-foreground">They&apos;re added to the job&apos;s pipeline with Referral as the source and the person who referred them.</p>
      <Section>
        {jobs.length === 0 ? (
          <p className="m-0 text-[13px] text-muted-foreground">
            There&apos;s no open job you can add people to. Back to{" "}
            <Link href="/client/referrals" className={textLink}>
              Referrals
            </Link>
            .
          </p>
        ) : (
          <ReferralForm action={action} jobs={jobs} teammates={teammates} resumeMaxBytes={resumeMaxBytes} resumeAccept={resumeAccept} />
        )}
      </Section>
    </Page>
  );
}
