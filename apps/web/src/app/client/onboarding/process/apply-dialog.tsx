"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Count, Notice } from "@/components/page";
import { Button } from "@/components/ui/button";
import type { ApplyAnswer, ApplyJob } from "@/lib/client/process";
import { applyProcessAction, previewApplyAction } from "./actions";
import { APPLY_ERRORS, SKIP_REASONS } from "./messages";

// Apply: the one way the process reaches a live job, asked for and shown first. It
// opens as a dry run of what is saved, says what each job would become, warns about
// a step renamed or removed, and lists what will be left. Only the button writes.
// Interviews are never rewritten: one on a step that goes keeps the old name.
// Testbench's dialog: 16px, the box surface, the title in Mona Sans, the buttons
// right-aligned over a hairline.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Warnings({ job }: { job: ApplyJob }) {
  const kept = (step: string) => job.keptOnInterviews.find((k) => k.step === step);
  const note = (step: string) => {
    const k = kept(step);
    if (!k) return "";
    const scheduled = k.scheduled ? ` (${k.scheduled} still scheduled)` : "";
    return ` ${plural(k.interviews, "interview keeps", "interviews keep")} the old name and will show as off-plan${scheduled}.`;
  };
  const renamed = job.change?.renamed ?? [];
  const removed = job.change?.removed ?? [];
  if (!renamed.length && !removed.length) return null;
  return (
    <ul className="proc-warn">
      {renamed.map((r) => (
        <li key={r.from}>
          &quot;{r.from}&quot; looks renamed to &quot;{r.to}&quot;.{note(r.from)}
        </li>
      ))}
      {removed.map((step) => (
        <li key={step}>
          &quot;{step}&quot; goes from the plan.{note(step)}
        </li>
      ))}
    </ul>
  );
}

function ChangeRow({ job, picked, onToggle, locked }: { job: ApplyJob; picked: boolean; onToggle: () => void; locked: boolean }) {
  return (
    <li className="proc-job">
      <input type="checkbox" checked={picked} disabled={locked} aria-label={`Apply to ${job.title}`} onChange={onToggle} />
      <div className="grid min-w-0 gap-0.5">
        <b className="flex min-w-0 flex-wrap items-baseline gap-x-3 font-medium [overflow-wrap:anywhere]">
          {job.title}
          {job.team ? <span className="text-[12px] font-normal text-faint">{job.team}</span> : null}
        </b>
        <span className="text-[12.5px] text-faint [overflow-wrap:anywhere]">{job.current.length ? job.current.join(" → ") : "No plan yet"}</span>
        <span className="text-[12.5px] [overflow-wrap:anywhere]">becomes {job.next?.join(" → ")}</span>
        <Warnings job={job} />
      </div>
    </li>
  );
}

function Skipped({ jobs }: { jobs: ApplyJob[] }) {
  if (!jobs.length) return null;
  return (
    <section aria-label="Skipped" className="grid gap-1.5">
      <h3 className="m-0 flex items-baseline gap-2 font-sans text-[14px] font-semibold">
        Skipped <Count>{jobs.length}</Count>
      </h3>
      <ul className="m-0 grid list-none gap-1 p-0">
        {jobs.map((j) => (
          <li key={j.jobId} className="text-[12.5px] [overflow-wrap:anywhere]">
            {j.title}: <span className="text-faint">{j.reason ? SKIP_REASONS[j.reason] : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ApplyDialog({ updatedAt, onClose }: { updatedAt: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [answer, setAnswer] = useState<ApplyAnswer | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    previewApplyAction(updatedAt)
      .then((a) => live && setAnswer(a))
      .catch(() => live && setAnswer({ ok: false, error: "failed" }));
    return () => {
      live = false;
    };
  }, [updatedAt]);

  const jobs = answer?.ok ? answer.jobs : [];
  const done = answer?.ok && answer.mode === "applied";
  const changing = jobs.filter((j) => j.state === "change");
  const same = jobs.filter((j) => j.state === "same");
  const skipped = jobs.filter((j) => j.state === "skipped");
  const picked = changing.filter((j) => !off.has(j.jobId));

  const toggle = (id: string) =>
    setOff((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const apply = () =>
    start(async () => {
      try {
        setAnswer(await applyProcessAction({ expectedUpdatedAt: updatedAt, jobIds: picked.map((j) => j.jobId) }));
      } catch {
        setAnswer({ ok: false, error: "failed" });
      }
    });

  const close = () => {
    if (!pending) onClose();
  };

  return (
    <dialog
      ref={dialog}
      aria-label="Apply to jobs"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClose={() => (pending ? dialog.current?.showModal() : onClose())}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="m-auto max-h-[calc(100dvh-64px)] w-[min(600px,calc(100vw-32px))] rounded-[16px] border-0 bg-[color:var(--surface)] p-0 text-foreground shadow-[var(--box-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      <div className="grid gap-4 p-6 text-[13px]">
        <h2 className="m-0 font-sans text-[20px] leading-[26px] font-semibold tracking-[-0.015em]">{done ? "Applied" : "Apply to jobs"}</h2>
        {done ? (
          <Notice>{answer.updated ? `${plural(answer.updated, "job")} changed.` : "No job changed."} Interviews already on a job were not touched.</Notice>
        ) : (
          <p className="m-0 text-muted-foreground">Each job&apos;s plan is replaced by the interviews on the way through for its team. Interviews already on a job are not touched. Saving never did this: only this button does.</p>
        )}

        {!answer ? <p className="m-0 text-faint">Working out what would change…</p> : null}
        {answer && !answer.ok ? <Notice tone="error">{APPLY_ERRORS[answer.error]}</Notice> : null}

        {answer?.ok ? (
          <>
            {changing.length ? (
              <section aria-label={done ? "Changed" : "What would change"} className="grid gap-1.5">
                <h3 className="m-0 flex items-baseline gap-2 font-sans text-[14px] font-semibold">
                  {done ? "Changed" : "Would change"} <Count>{changing.length}</Count>
                </h3>
                <ul className="m-0 grid list-none rounded-[10px] bg-[color:var(--paper)] px-4 py-1 shadow-[var(--shadow-sm)]">
                  {changing.map((j) => (
                    <ChangeRow key={j.jobId} job={j} picked={!off.has(j.jobId)} locked={!!done || pending} onToggle={() => toggle(j.jobId)} />
                  ))}
                </ul>
              </section>
            ) : (
              <p className="m-0 text-faint">{done ? "" : jobs.length ? "No job's plan would change." : "There are no jobs to apply this to."}</p>
            )}
            {same.length ? <p className="m-0 text-[12.5px] text-faint">{plural(same.length, "job already matches", "jobs already match")}.</p> : null}
            <Skipped jobs={skipped} />
            <p className="m-0 text-xs text-faint">
              Only open, paused and pending jobs you can see are here. A confidential job you&apos;re not on isn&apos;t listed, and stays as it is.
              {answer.truncated ? " The list stopped at 5,000 jobs." : ""}
            </p>
          </>
        ) : null}

        <div className="-mx-6 -mb-6 flex justify-end gap-2 border-t border-[color:var(--line)] px-6 py-4">
          <Button type="button" variant="outline" disabled={pending} onClick={close}>
            {done ? "Close" : "Cancel"}
          </Button>
          {done || !answer?.ok ? null : (
            <Button type="button" disabled={pending || !picked.length} onClick={apply}>
              {pending ? "Applying…" : `Apply to ${plural(picked.length, "job")}`}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}
