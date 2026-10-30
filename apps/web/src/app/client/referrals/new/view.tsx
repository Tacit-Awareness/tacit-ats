import Link from "next/link";
import { Notice, Page, PageBar, Section, textLink } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { Input, selectClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ReferralJob } from "@/lib/client/referrals";

// The "Add referral" form's markup, props only (page.tsx does the reads):
// design/tats's form (candidate, email, LinkedIn, job, who referred them, why
// they're a fit) as a page. "Referred by" is free text, with the team's names
// offered as suggestions; it is stored as typed. The browser's own checks come
// first, since what was typed is not kept across an error redirect.

export function AddReferralView({
  action,
  jobs,
  teammates,
  error,
}: {
  action: (form: FormData) => Promise<void>;
  jobs: ReferralJob[];
  teammates: string[];
  error: string | null;
}) {
  return (
    <Page narrow bar={<PageBar crumbs={[{ href: "/client/referrals", label: "Referrals" }]} title="Add referral" />}>
      <p className="m-0 text-[13px] text-muted-foreground">They&apos;re added to the job&apos;s pipeline with Referral as the source and the person who referred them.</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
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
          <form action={action} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="name">Candidate</Label>
                <Input id="name" name="name" required maxLength={200} placeholder="Full name" autoComplete="off" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="jobId">Job</Label>
                <select id="jobId" name="jobId" required defaultValue={jobs.length === 1 ? jobs[0]!.jobId : ""} className={selectClass}>
                  {jobs.length > 1 ? (
                    <option value="" disabled>
                      Pick a job
                    </option>
                  ) : null}
                  {jobs.map((j) => (
                    <option key={j.jobId} value={j.jobId}>
                      {j.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" maxLength={254} placeholder="name@company.com" autoComplete="off" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="linkedinUrl">LinkedIn</Label>
                <Input id="linkedinUrl" name="linkedinUrl" maxLength={300} placeholder="linkedin.com/in/…" autoComplete="off" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="referredBy">Referred by</Label>
              <Input id="referredBy" name="referredBy" required maxLength={200} list="referrers" placeholder="Who referred them" autoComplete="off" />
              <datalist id="referrers">
                {teammates.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="note">Why they&apos;re a fit</Label>
              <Textarea id="note" name="note" rows={3} maxLength={2000} placeholder="How they know them, and what they'd be great at" />
            </div>
            <div className="flex items-center gap-3">
              <SubmitButton pendingLabel="Adding…">Add referral</SubmitButton>
              <Link href="/client/referrals" className={textLink}>
                Cancel
              </Link>
            </div>
            <p className="m-0 text-xs text-faint">An email already on someone you can see adds that person rather than a new one. The note goes on their application.</p>
          </form>
        )}
      </Section>
    </Page>
  );
}
