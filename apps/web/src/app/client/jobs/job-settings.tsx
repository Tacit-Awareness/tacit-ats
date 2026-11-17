"use client";

import { useActionState } from "react";
import { MiniTitle, Notice, Pill } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { Input, selectClass } from "@/components/ui/input";
import {
  CLOSE_REASON_MAX, JOB_SETTINGS_ERRORS, JOB_SETTINGS_NOTICES, JOB_STATUS_LABEL, JOB_TITLE_MAX, OPENINGS_ADD_MAX, SETTABLE_STATUSES,
  type JobFormState, type JobSettings as Settings, type OpeningsFormState,
} from "@/lib/client/job-settings-rules";
import { buttonVariants } from "@/components/ui/button";
import type { JobTestbench } from "@/lib/client/testbench";
import { cn } from "@/lib/utils";
import { addOpeningsAction, closeOpeningAction, saveJobAction, saveTestbenchRoleAction } from "./actions";
import type { TestbenchFormState } from "./messages";

// The job itself, in the posting editor's "Only your team sees this" card:
// design/tats's Live / Paused chip, as the job's status (open, paused, closed;
// filled is the database's, on the last hire), the job's own title (the
// post's title above is what applicants read), and its openings. Each form
// saves at once, apart from the post's draft, and answers in place: React
// resets a form to its defaults when its action ends, so the defaults are a
// refusal's draft or what the page read. Testbench's fields: a label in Geist
// Mono 500 over a raised field; what a field means is its hover title, not a
// caption under it.

const FIRST = {};
const label = "grid gap-1.5";
const labelText = "font-mono text-[13px] leading-[18px] font-medium text-foreground";
const TITLE_MEANS = "The job title is what your team sees on the board and in lists.";
const STATUS_MEANS = "A post takes applications only while its job is open.";

function Said({ state }: { state: JobFormState | OpeningsFormState }) {
  if (state.error) return <Notice tone="error">{JOB_SETTINGS_ERRORS[state.error]}</Notice>;
  if (state.notice) return <Notice>{JOB_SETTINGS_NOTICES[state.notice]}</Notice>;
  return null;
}

function JobForm({ settings }: { settings: Settings }) {
  const [state, action] = useActionState<JobFormState, FormData>(saveJobAction, FIRST);
  const draft = state.draft ?? { title: settings.title, status: settings.status };
  // After a refusal for a status that moved on, the form opens on the job's status now, not the one picked.
  const status = state.draft && state.error !== "status_changed" ? state.draft.status : settings.status;
  const statuses: string[] = (SETTABLE_STATUSES as readonly string[]).includes(settings.status) ? [...SETTABLE_STATUSES] : [settings.status, ...SETTABLE_STATUSES];
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="jobId" value={settings.jobId} />
      <input type="hidden" name="was:title" value={settings.title} />
      {/* The status the select was drawn against, kept with it: a select only
          reads its defaultValue when it mounts, so it is keyed on the page's
          status and drawn again whenever that moves on (this form's own save,
          another tab, the connector). Otherwise it would keep the old status
          while was:status moved on, and a title-only save would send it back. */}
      <input type="hidden" name="was:status" value={settings.status} />
      <Said state={state} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
        <label className={label} title={TITLE_MEANS}>
          <span className={labelText}>Job title</span>
          <Input name="title" defaultValue={draft.title} maxLength={JOB_TITLE_MAX} required />
        </label>
        <label className={label} title={STATUS_MEANS}>
          <span className={labelText}>Status</span>
          <select key={`${settings.status}:${status}`} name="status" defaultValue={status} className={selectClass}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_LABEL[s] ?? s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton variant="outline">Save job</SubmitButton>
      </div>
      <p className="sr-only">
        {TITLE_MEANS} {STATUS_MEANS}
      </p>
    </form>
  );
}

function Openings({ jobId, openings }: { jobId: string; openings: NonNullable<Settings["openings"]> }) {
  const [added, add] = useActionState<OpeningsFormState, FormData>(addOpeningsAction, FIRST);
  const [closed, close] = useActionState<OpeningsFormState, FormData>(closeOpeningAction, FIRST);
  const { counts } = openings;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MiniTitle className="mt-0 mr-1">Openings</MiniTitle>
        <Pill>{counts.open} open</Pill>
        <Pill>{counts.filled} filled</Pill>
        {counts.closed ? <Pill>{counts.closed} closed</Pill> : null}
      </div>
      <Said state={added} />
      <Said state={closed} />
      {openings.open.length ? (
        <ul className="m-0 list-none p-0">
          {openings.open.map((o) => (
            <li key={o.openingId} className="border-b border-[color:var(--line)] first:border-t">
              <details open={closed.draft?.openingId === o.openingId} className="group/op">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-[8px] px-2 text-[13px] transition-colors hover:bg-[color:var(--surface)] [&::-webkit-details-marker]:hidden">
                  <span className="font-medium">Opening {o.number}</span>
                  {o.code ? <span className="text-faint">{o.code}</span> : null}
                  <span className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto group-open/op:hidden")}>Close…</span>
                </summary>
                <form action={close} className="flex flex-wrap items-center gap-2 px-2 pt-1 pb-3">
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

const TESTBENCH_MEANS = "The Testbench role this job's test comes from. With one picked, New Applicants offers a Testbench reply carrying each candidate's own invite link.";

/**
 * Which Testbench role the job's test comes from: the company's own roles in
 * Testbench, read on the server. A role that can't take invitations now
 * (closed, or no published test) is listed and says so; the job's current
 * role stays listed even when Testbench no longer has it.
 */
function TestbenchForm({ testbench }: { testbench: JobTestbench }) {
  const [state, action] = useActionState<TestbenchFormState, FormData>(saveTestbenchRoleAction, FIRST);
  const known = testbench.roles.some((r) => r.id === testbench.roleId);
  const current = state.picked !== undefined ? state.picked : (testbench.roleId ?? "");
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="jobId" value={testbench.jobId} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : state.saved ? <Notice>Saved.</Notice> : null}
      {testbench.unavailable ? <Notice tone="error">{testbench.unavailable}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className={label} title={TESTBENCH_MEANS}>
          <span className={labelText}>Testbench role</span>
          <select key={`${testbench.roleId}:${current}`} name="testbenchRoleId" defaultValue={current} className={selectClass}>
            <option value="">No Testbench test</option>
            {testbench.roleId && !known ? <option value={testbench.roleId}>{testbench.unavailable ? "The role picked now" : "A role Testbench no longer lists"}</option> : null}
            {testbench.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.invitable ? r.title : `${r.title} (can't take invitations: ${r.status === "open" || !r.status ? "no published test" : r.status})`}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton variant="outline">Save Testbench role</SubmitButton>
      </div>
      <p className="sr-only">{TESTBENCH_MEANS}</p>
    </form>
  );
}

/** The job's own part of the team's card: the job, then its openings, then its Testbench role, a hairline between and under them. */
export function JobSettingsPanel({ settings, testbench = null }: { settings: Settings; testbench?: JobTestbench | null }) {
  return (
    <div className="grid gap-5 border-b border-[color:var(--line)] pt-4 pb-5">
      <div className="grid gap-3">
        <MiniTitle className="mt-0">The job</MiniTitle>
        <JobForm settings={settings} />
      </div>
      {settings.openings ? (
        <div className="border-t border-[color:var(--line)] pt-5">
          <Openings jobId={settings.jobId} openings={settings.openings} />
        </div>
      ) : null}
      {testbench ? (
        <div className="grid gap-3 border-t border-[color:var(--line)] pt-5">
          <MiniTitle className="mt-0">Testbench</MiniTitle>
          <TestbenchForm testbench={testbench} />
        </div>
      ) : null}
    </div>
  );
}
