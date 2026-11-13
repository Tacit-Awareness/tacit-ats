"use client";

import { startTransition, useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { Kbd } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { profileLabel, understand, type IntakeJob } from "@/lib/client/intake-parse";
import { cn } from "@/lib/utils";
import { CmdEnter } from "../inbox/keycaps";
import "./intake-composer.css";

// The intake composer: how someone gets added by hand, as an applicant (New
// Applicants, someone the team recruited or met) or as a referral (Referrals).
// No form of labelled fields: one roomy box to write or paste in, the way
// you'd tell a teammate ("Maya Chen, maya@acme.com, linkedin.com/in/maya-chen.
// Met her at the infra meetup, strong on queues"), and a place to drop a
// resume. What was understood shows as quiet chips under the box as they type
// (lib/client/intake-parse.ts): the name, the email, the LinkedIn profile, the
// job (named in the text, else the one in view) and, for a referral, who
// referred them (the member, unless the text says "referred by …"). A chip is
// clicked to correct it; the job's opens a small menu. The rest of the text is
// the note. Add posts exactly the fields the server action has always taken,
// so nothing about what is stored changes; a refusal is one sentence under the
// box and what was typed stays. Once added, the action redirects and the
// composer closes. A native <dialog>: the page's keys stand down while it is
// open, Esc closes it (a chip being corrected or the job menu takes Esc first),
// and nothing closes it mid-add.

export type IntakeKind = "applicant" | "referral";
export type IntakeState = { status: "idle" } | { status: "error"; error: string };

export type IntakeProps = {
  kind: IntakeKind;
  /** addApplicantAction or addReferralAction; a method, so either one's own error codes fit. */
  action(prev: IntakeState, form: FormData): Promise<IntakeState>;
  /** The open jobs the member may add people to; none, and the composer says so instead. */
  jobs: IntakeJob[];
  /** The job in view, when the text names none. */
  preferJob: string | null;
  /** The signed-in member: who referred them, until the text or a chip says otherwise. */
  me: string | null;
  /** The team's names, to name a referrer in full and to suggest one. */
  teammates: string[];
  /** The action's codes, worded. */
  errors: Record<string, string>;
  resumeMaxBytes: number;
  resumeAccept: string;
};

type Field = "name" | "email" | "linkedinUrl" | "referredBy";

const IDLE: IntakeState = { status: "idle" };
const TITLE: Record<IntakeKind, string> = { applicant: "Add applicant", referral: "Add referral" };
const PLACEHOLDER: Record<IntakeKind, string> = {
  applicant: "Maya Chen, maya@acme.com, linkedin.com/in/maya-chen. Met her at the infra meetup, strong on queues",
  referral: "Maya Chen, maya@acme.com, linkedin.com/in/maya-chen. Worked with her at Stripe, strong on queues",
};
const MAX: Record<Field, number> = { name: 200, email: 254, linkedinUrl: 300, referredBy: 200 };
const EDIT_LABEL: Record<Field, string> = { name: "Their name", email: "Their email", linkedinUrl: "Their LinkedIn profile", referredBy: "Who referred them" };

// Testbench's `.chip`, as a button: it says what was understood and is clicked to correct it.
const chip =
  "intake-chip inline-flex h-[26px] max-w-full min-w-0 items-center gap-1.5 rounded-[6px] bg-[color:var(--paper)] px-[9px] font-mono text-[12.5px] leading-none text-foreground shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors duration-150 hover:bg-[color:var(--hover)]";
// Something it still needs: dashed, faint, the same height (a border, so the focus ring stays the app's).
const missing = "border border-dashed border-[color:var(--line-strong)] bg-transparent text-faint shadow-none hover:text-foreground";

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-3 flex-none text-faint">
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="ml-auto size-[15px] flex-none">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

function Clip() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-[15px] flex-none">
      <path d="m13.5 7.5-5.3 5.3a3.3 3.3 0 0 1-4.7-4.7l5.6-5.6a2.2 2.2 0 0 1 3.1 3.1l-5.6 5.6a1.1 1.1 0 0 1-1.6-1.6L10.2 4.4" />
    </svg>
  );
}

function Cross() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden className="size-3.5">
      <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

/** A chip being corrected: the same size, its value selected, Enter or leaving it keeps it, Esc puts it back. */
function ChipEdit({ field, value, list, onDone }: { field: Field; value: string; list?: string; onDone: (v: string | null) => void }) {
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      defaultValue={value}
      aria-label={EDIT_LABEL[field]}
      maxLength={MAX[field]}
      list={list}
      autoComplete="off"
      spellCheck={false}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === "Escape") {
          // The chip's, not the dialog's.
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="h-[26px] w-[220px] max-w-full rounded-[6px] border-0 bg-[color:var(--paper)] px-[9px] font-mono text-[12.5px] text-foreground shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_rgba(34,35,38,0.12)] outline-none"
    />
  );
}

/** The job, as a chip that opens a small menu of the jobs the member may add people to. */
function JobChip({ jobs, value, onPick, onOpenChange }: { jobs: IntakeJob[]; value: string | null; onPick: (jobId: string) => void; onOpenChange: (open: boolean) => void }) {
  const [open, setOpenState] = useState(false);
  // Under a chip near the right of the dialog, the menu hangs from its right edge, so it stays over the dialog.
  const [fromRight, setFromRight] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const setOpen = (v: boolean) => {
    if (v) {
      const chipBox = box.current?.getBoundingClientRect();
      const dialogBox = box.current?.closest("dialog")?.getBoundingClientRect();
      setFromRight(Boolean(chipBox && dialogBox && dialogBox.right - chipBox.left < 300));
    }
    setOpenState(v);
    onOpenChange(v);
  };
  const picked = jobs.find((j) => j.jobId === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? []);
    (items().find((el) => el.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
    // setOpen is stable enough here: it only sets state and tells the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const move = (d: 1 | -1) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + d + items.length) % items.length]?.focus();
  };

  return (
    <span ref={box} className="relative inline-flex max-w-full min-w-0">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={picked ? `Job: ${picked.title}. Click to change it.` : "Pick the job to add them to"}
        onClick={() => setOpen(!open)}
        className={cn(chip, !picked && missing)}
      >
        <span className="min-w-0 truncate">{picked?.title ?? "Pick a job"}</span>
        <Chevron />
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Job"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            } else if (e.key === "Escape" || e.key === "Tab") {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
              }
              setOpen(false);
              button.current?.focus();
            }
          }}
          className={cn(
            "absolute bottom-full z-20 mb-1.5 grid max-h-[280px] w-max max-w-[min(380px,calc(100vw-64px))] min-w-[260px] overflow-y-auto rounded-[12px] bg-[color:var(--paper)] p-1.5 shadow-[var(--pop-shadow)]",
            fromRight ? "right-0 origin-bottom-right" : "left-0 origin-bottom-left",
          )}
        >
          {jobs.map((j) => (
            <button
              key={j.jobId}
              type="button"
              role="menuitemradio"
              aria-checked={j.jobId === value}
              onClick={() => {
                onPick(j.jobId);
                setOpen(false);
                button.current?.focus();
              }}
              className="flex h-[34px] w-full min-w-0 items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] text-foreground transition-colors outline-none hover:bg-[color:var(--hover)] focus-visible:bg-[color:var(--hover)]"
            >
              <span className="min-w-0 truncate">{j.title}</span>
              {j.jobId === value ? <Check /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "");

/** The composer, open: a native modal <dialog>. `onClose` is called once it has closed, by any route. */
export function IntakeComposer({ kind, action, jobs, preferJob, me, teammates, errors, resumeMaxBytes, resumeAccept, onClose }: IntakeProps & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listId = useId();
  const [state, run, pending] = useActionState(action, IDLE);

  const [text, setText] = useState("");
  const [over, setOver] = useState<Partial<Record<Field, string>>>({});
  const [jobPick, setJobPick] = useState<string | null>(null);
  const [editing, setEditing] = useState<Field | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The state an add started from: the same one once it settles means it redirected (added), a new one is a refusal.
  const sentFrom = useRef<IntakeState | null>(null);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  useEffect(() => {
    if (state.status === "error") setError(errors[state.error] ?? errors.failed ?? "That didn't work. Nobody was added.");
  }, [state, errors]);

  useEffect(() => {
    if (pending || sentFrom.current === null) return;
    const from = sentFrom.current;
    sentFrom.current = null;
    // Added: the page has moved on (and says so), so the composer goes.
    if (state === from) dialog.current?.close();
  }, [pending, state]);

  const read = useMemo(() => understand(text, { jobs, preferJob, kind, teammates, me }), [text, jobs, preferJob, kind, teammates, me]);
  const value = (f: Field): string | null => {
    const o = over[f];
    if (o !== undefined) return o.trim() || null;
    return f === "referredBy" ? (read.referredBy ?? me) : read[f];
  };
  const name = value("name");
  const email = value("email");
  const linkedinUrl = value("linkedinUrl");
  const referredBy = kind === "referral" ? value("referredBy") : null;
  const jobId = jobPick ?? read.jobId ?? (preferJob && jobs.some((j) => j.jobId === preferJob) ? preferJob : null) ?? (jobs.length === 1 ? jobs[0]!.jobId : null);
  const ready = Boolean(name && jobId && (kind === "applicant" || referredBy));
  const why = !name ? "Write their name to add them" : !jobId ? "Pick a job to add them to" : kind === "referral" && !referredBy ? "Say who referred them" : `${TITLE[kind]} (⌘↵)`;

  const changed = () => setError(null);

  const take = (f: File | null | undefined) => {
    changed();
    if (!f) return;
    const accepted = resumeAccept.split(",").map((e) => e.trim().toLowerCase());
    if (f.size === 0 || f.size > resumeMaxBytes || !accepted.includes(extOf(f.name))) {
      setError(errors.invalid_file ?? "That file can't be a resume.");
      return;
    }
    setFile(f);
  };

  const submit = () => {
    if (!ready || pending || !jobId || !name) return;
    const post = new FormData();
    post.set("name", name);
    if (email) post.set("email", email);
    if (linkedinUrl) post.set("linkedinUrl", linkedinUrl);
    post.set("jobId", jobId);
    if (referredBy) post.set("referredBy", referredBy);
    if (read.note) post.set("note", read.note);
    if (file) post.set("resume", file);
    setError(null);
    sentFrom.current = state;
    startTransition(() => run(post));
  };

  const edit = (f: Field) => (v: string | null) => {
    setEditing(null);
    if (v !== null) {
      setOver((o) => ({ ...o, [f]: v }));
      changed();
    }
  };

  const chipFor = (f: Field, shown: string | null, label: string, opts: { prefix?: string; need?: boolean } = {}) => {
    if (editing === f) return <ChipEdit key={f} field={f} value={value(f) ?? ""} list={f === "referredBy" ? listId : undefined} onDone={edit(f)} />;
    if (!shown && !opts.need) return null;
    return (
      <button key={f} type="button" onClick={() => setEditing(f)} title={shown ? `${label}: click to correct it` : `Add ${label.toLowerCase()}`} className={cn(chip, !shown && missing)}>
        {opts.prefix && shown ? <span className="flex-none text-faint">{opts.prefix}</span> : null}
        <span className="min-w-0 truncate">{shown ?? label}</span>
      </button>
    );
  };

  const noJobs = jobs.length === 0;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      // Mid-add it comes straight back, or a refusal would land in a closed dialog.
      onClose={() => (pending ? dialog.current?.showModal() : onClose())}
      onCancel={(e) => {
        if (pending || editing || menuOpen) e.preventDefault();
      }}
      onMouseDown={(e) => {
        if (e.target === dialog.current && !pending) dialog.current?.close();
      }}
      // A file dropped anywhere on it is the resume, never the browser opening it.
      onDragOver={(e) => {
        if (noJobs || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget || !dialog.current?.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        if (noJobs || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files[0]);
      }}
      className="m-auto w-[calc(100%-32px)] max-w-[620px] overflow-visible rounded-[16px] border-0 bg-[color:var(--surface)] p-0 text-foreground shadow-[var(--box-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid"
      >
        <div className="grid gap-3 p-6">
          <h2 id={titleId} className="m-0 font-sans text-[20px] leading-[26px] font-semibold tracking-[-0.015em]">
            {TITLE[kind]}
          </h2>
          {noJobs ? (
            <p className="m-0 text-[13px] text-muted-foreground">There&apos;s no open job you can add people to.</p>
          ) : (
            <>
              <div
                data-over={dragging || undefined}
                className={cn(
                  "grid overflow-hidden rounded-[10px] bg-[color:var(--paper)] shadow-[inset_0_0_0_1px_var(--field)] transition-shadow duration-150",
                  "hover:shadow-[inset_0_0_0_1px_var(--muted-text)] focus-within:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_rgba(34,35,38,0.12)] focus-within:hover:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_rgba(34,35,38,0.12)]",
                  "data-[over]:bg-[color:var(--accent-soft)] data-[over]:shadow-[inset_0_0_0_1.5px_var(--accent)]",
                )}
              >
                <textarea
                  autoFocus
                  value={text}
                  onChange={(e) => {
                    const v = e.target.value;
                    setText(v);
                    changed();
                    // Starting again starts the corrections again.
                    if (!v.trim()) setOver({});
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  readOnly={pending}
                  maxLength={2000}
                  rows={5}
                  aria-label="Who they are, and anything else about them"
                  placeholder={PLACEHOLDER[kind]}
                  className="block max-h-[38vh] min-h-[132px] w-full resize-none border-0 bg-transparent px-3.5 pt-3 pb-2 font-sans text-[14px] leading-[22px] text-foreground outline-none [field-sizing:content] placeholder:text-faint"
                />
                <div className="flex min-h-11 items-center gap-2 border-t border-[color:var(--line)] px-1.5">
                  {file ? (
                    <span className="intake-chip flex h-[30px] min-w-0 items-center gap-2 rounded-[7px] pr-1 pl-2 text-[12.5px] text-foreground">
                      <Clip />
                      <span className="min-w-0 truncate" title={file.name}>
                        {file.name}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        title="Remove"
                        disabled={pending}
                        onClick={() => {
                          setFile(null);
                          changed();
                          if (picker.current) picker.current.value = "";
                        }}
                        className="grid size-6 flex-none place-items-center rounded-[6px] text-faint transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
                      >
                        <Cross />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => picker.current?.click()}
                      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-w-0 gap-2 px-2 font-normal text-faint")}
                    >
                      <Clip />
                      <span className="truncate">{dragging ? "Drop the resume here" : "Drop a resume, or choose one"}</span>
                    </button>
                  )}
                  <input
                    ref={picker}
                    type="file"
                    accept={resumeAccept}
                    tabIndex={-1}
                    aria-hidden
                    className="hidden"
                    onChange={(e) => take(e.currentTarget.files?.[0])}
                  />
                </div>
              </div>
              <div role="group" aria-label="What was understood" className="flex min-h-[26px] flex-wrap items-center gap-1.5">
                {chipFor("name", name, "Name", { need: text.trim() !== "" })}
                {chipFor("email", email, "Email")}
                {chipFor("linkedinUrl", linkedinUrl ? profileLabel(linkedinUrl) : null, "LinkedIn")}
                <JobChip
                  jobs={jobs}
                  value={jobId}
                  onOpenChange={setMenuOpen}
                  onPick={(id) => {
                    setJobPick(id);
                    changed();
                  }}
                />
                {kind === "referral" ? chipFor("referredBy", referredBy, "Who referred them", { prefix: "Referred by", need: true }) : null}
                {kind === "referral" ? (
                  <datalist id={listId}>
                    {teammates.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                ) : null}
              </div>
              {error ? (
                <p role="alert" className="m-0 text-[13px] leading-5 text-[color:var(--red)]">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[color:var(--line)] px-6 py-4">
          <Button type="button" variant="outline" disabled={pending} onClick={() => dialog.current?.close()}>
            {noJobs ? "Close" : "Cancel"}
          </Button>
          {noJobs ? null : (
            // The reason it can't add yet is the hover; a disabled button takes no pointer, so its wrapper holds the title.
            <span title={why} className="inline-flex">
              <Button type="submit" disabled={!ready || pending} aria-keyshortcuts="Meta+Enter">
                {pending ? "Adding…" : "Add"}
                <Kbd>
                  <CmdEnter />
                </Kbd>
              </Button>
            </span>
          )}
        </div>
      </form>
    </dialog>
  );
}

/** The button that opens the composer, and the composer while it is open. `startOpen` and `closeTo` are the /client/referrals/new route's. */
export function IntakeButton({
  label,
  variant = "default",
  startOpen = false,
  closeTo,
  tour,
  ...props
}: IntakeProps & { label: string; variant?: "default" | "outline"; startOpen?: boolean; closeTo?: string; tour?: string }) {
  const [open, setOpen] = useState(startOpen);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" data-tour={tour} aria-haspopup="dialog" onClick={() => setOpen(true)} className={buttonVariants({ variant })}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
          <path d="M8 3v10M3 8h10" />
        </svg>
        {label}
      </button>
      {open ? (
        <IntakeComposer
          {...props}
          onClose={() => {
            setOpen(false);
            if (closeTo) window.history.replaceState(null, "", closeTo);
            button.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
