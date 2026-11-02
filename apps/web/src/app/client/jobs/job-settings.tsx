"use client";

import { useActionState } from "react";
import { Notice } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { Input, selectClass } from "@/components/ui/input";
import {
  CLOSE_REASON_MAX, JOB_SETTINGS_ERRORS, JOB_SETTINGS_NOTICES, JOB_STATUS_LABEL, JOB_TITLE_MAX, OPENINGS_ADD_MAX, SETTABLE_STATUSES,
  type JobFormState, type JobSettings as Settings, type OpeningsFormState,
} from "@/lib/client/job-settings-rules";
import { cn } from "@/lib/utils";
import { addOpeningsAction, closeOpeningAction, saveJobAction } from "./actions";

// The job itself, under the posting editor's "Only your team sees this":
// design/tats's Live / Paused chip, as the job's status (open, paused, closed;
// filled is the database's, on the last hire), the job's own title (the
// post's title above is what applicants read), and its openings. Each form
// saves at once, apart from the post's draft, and answers in place: React
// resets a form to its defaults when its action ends, so the defaults are a
// refusal's draft or what the page read.

const FIRST = {};
const heading = "m-0 mb-2 text-[13px] font-semibold";

function Said({ state }: { state: JobFormState | OpeningsFormState }) {
  if (state.error) return <Notice tone="error">{JOB_SETTINGS_ERRORS[state.error]}</Notice>;
  if (state.notice) return <Notice>{JOB_SETTINGS_NOTICES[state.notice]}</Notice>;
  return null;
}

function JobForm({ settings }: { settings: Settings }) {
  const [state, action] = useActionState<JobFormState, FormData>(saveJobAction, FIRST);
  const draft = state.draft ?? { title: settings.title, status: settings.status };
  const statuses: string[] = (SETTABLE_STATUSES as readonly string[]).includes(settings.status) ? [...SETTABLE_STATUSES] : [settings.status, ...SETTABLE_STATUSES];
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="jobId" value={settings.jobId} />
      <input type="hidden" name="was:title" value={settings.title} />
      <input type="hidden" name="was:status" value={settings.status} />
      <Said state={state} />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-end">
        <label className="grid gap-1 text-[12.5px] text-muted-foreground">
          Job title
          <Input name="title" defaultValue={draft.title} maxLength={JOB_TITLE_MAX} required />
        </label>
        <label className="grid gap-1 text-[12.5px] text-muted-foreground">
          Status
          <select name="status" defaultValue={draft.status} className={selectClass}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_LABEL[s] ?? s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton variant="outline">Save job</SubmitButton>
      </div>
      <p className="m-0 text-xs text-faint">
        The job title is what your team sees on the board and in lists. A post takes applications only while its job is open.
      </p>
    </form>
  );
}

function Openings({ jobId, openings }: { jobId: string; openings: NonNullable<Settings["openings"]> }) {
  const [added, add] = useActionState<OpeningsFormState, FormData>(addOpeningsAction, FIRST);
  const [closed, close] = useActionState<OpeningsFormState, FormData>(closeOpeningAction, FIRST);
  const { counts } = openings;
  return (
    <div className="grid gap-2">
      <p className={cn(heading, "mb-0")}>
        Openings{" "}
        <span className="font-normal text-faint">
          {counts.open} open · {counts.filled} filled{counts.closed ? ` · ${counts.closed} closed` : ""}
        </span>
      </p>
      <Said state={added} />
      <Said state={closed} />
      {openings.open.length ? (
        <ul className="m-0 list-none p-0">
          {openings.open.map((o) => (
            <li key={o.openingId} className="border-b border-[color:var(--line)] py-1.5">
              <details open={closed.draft?.openingId === o.openingId} className="group/op">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] [&::-webkit-details-marker]:hidden">
                  <span>
                    Opening {o.number}
                    {o.code ? <span className="text-faint"> · {o.code}</span> : null}
                  </span>
                  <span className="ml-auto text-xs text-faint group-open/op:hidden">Close…</span>
                </summary>
                <form action={close} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="openingId" value={o.openingId} />
                  <Input
                    name="reason"
                    aria-label={`Why opening ${o.number} is closing`}
                    placeholder="Why it's closing, e.g. budget moved"
                    defaultValue={closed.draft?.openingId === o.openingId ? closed.draft.reason : ""}
                    maxLength={CLOSE_REASON_MAX}
                    required
                    className="min-w-0 flex-1"
                  />
                  <SubmitButton variant="outline" pendingLabel="Closing…">
                    Close opening
                  </SubmitButton>
                </form>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-faint">No open openings. A hire fills the oldest open one.</p>
      )}
      <form action={add} className="flex items-center gap-2">
        <input type="hidden" name="jobId" value={jobId} />
        <Input
          name="count"
          type="number"
          min={1}
          max={OPENINGS_ADD_MAX}
          defaultValue={added.draft?.count ?? "1"}
          aria-label="How many openings to add"
          className="w-20"
        />
        <SubmitButton variant="outline" pendingLabel="Adding…">
          Add openings
        </SubmitButton>
      </form>
    </div>
  );
}

export function JobSettingsPanel({ settings }: { settings: Settings }) {
  return (
    <div className="mb-5 grid gap-5 border-b border-[color:var(--line)] pb-5">
      <div>
        <p className={heading}>The job</p>
        <JobForm settings={settings} />
      </div>
      {settings.openings ? <Openings jobId={settings.jobId} openings={settings.openings} /> : null}
    </div>
  );
}
