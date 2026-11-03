"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";
import { Notice, textLink } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ReferralJob } from "@/lib/client/referrals";
import { REFERRAL_ERRORS, type ReferralState } from "../messages";
import { ResumeInput } from "./resume-input";

// The "Add referral" form: design/tats's form (candidate, email, LinkedIn, job,
// who referred them, why they're a fit). "Referred by" is free text, with the
// team's names offered as suggestions; it is stored as typed. A refusal is
// answered in place and what was typed, the resume included, stays: not
// <form action>, which React resets when the action settles. Once added, the
// action redirects to the list.

const IDLE: ReferralState = { status: "idle" };

export function ReferralForm({
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
  const [state, run, pending] = useActionState(action, IDLE);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const post = new FormData(e.currentTarget);
        startTransition(() => run(post));
      }}
      className="grid gap-3"
    >
      {state.status === "error" ? <Notice tone="error">{REFERRAL_ERRORS[state.error]}</Notice> : null}
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
      <div className="grid gap-1.5">
        <Label htmlFor="resume">Resume</Label>
        <ResumeInput maxBytes={resumeMaxBytes} accept={resumeAccept} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add referral"}
        </Button>
        <Link href="/client/referrals" className={textLink}>
          Cancel
        </Link>
      </div>
      <p className="m-0 text-xs text-faint">An email already on someone you can see adds that person rather than a new one. The note goes on their application and the resume on their file, unless they're already in that job.</p>
    </form>
  );
}
