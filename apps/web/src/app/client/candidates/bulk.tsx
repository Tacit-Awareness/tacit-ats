"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useKeyHelp, useKeys } from "@/components/keys";
import { Notice } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import { NOTE_MAX } from "@/lib/client/note-max";
import {
  BULK_ERRORS,
  BULK_MAX,
  rejectPlan,
  retryPicked,
  summarize,
  type BulkAction,
  type BulkAnswer,
  type BulkItem,
  type BulkSummary,
} from "@/lib/client/crm-bulk-rules";
import { cn } from "@/lib/utils";
import { bulkAddToPoolAction, bulkRejectAction, bulkTagAction } from "./actions";
import { clearPicked, keepItems, syncItems, toggleItem, togglePageItems, usePicked } from "./selection";

// The CRM's selection and bulk actions, as design/tats's `.ck` boxes and
// `.bulk` bar: a box on every row, X on the focused row, Esc to clear, and a
// bar with Reject, Tag and Add to pool once anything is selected. Each action
// asks first in a dialog, then shows what happened to every row there:
// the server answers with ids and codes, and the names are the ones already
// on this page. After a run only the rows worth trying again stay selected;
// the table refreshes.

export type BulkOptions = {
  reasons: { reasonId: string; name: string }[];
  tags: string[];
  pools: string[];
};

/** design/tats's `.ck`: a button, not an input, so J/K/X keep working with focus on it (lib/keys.ts's isTyping). */
function Box({ checked, label, onToggle }: { checked: boolean | "mixed"; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className="group grid size-full place-items-center outline-offset-[-2px]"
    >
      <span
        aria-hidden
        className={cn(
          "grid size-4 place-items-center rounded-[4px] border border-[color:var(--line-strong)] text-[color:var(--accent-ink)] transition-colors group-hover:border-[color:var(--faint)]",
          checked && "border-[color:var(--accent)] bg-[color:var(--accent)] group-hover:border-[color:var(--accent)]",
        )}
      >
        {checked === "mixed" ? (
          <i className="h-[1.5px] w-2 rounded-full bg-current" />
        ) : checked ? (
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-3">
            <path d="m2.5 6.2 2.4 2.4 4.6-5" />
          </svg>
        ) : null}
      </span>
    </button>
  );
}

export function RowCheck({ item }: { item: BulkItem }) {
  const picked = usePicked();
  return <Box checked={picked.has(item.candidateId)} label={`Select ${item.name}`} onToggle={() => toggleItem(item)} />;
}

export function PageCheck({ items }: { items: BulkItem[] }) {
  const picked = usePicked();
  const on = items.filter((i) => picked.has(i.candidateId)).length;
  return <Box checked={on === 0 ? false : on === items.length ? true : "mixed"} label="Select this page" onToggle={() => togglePageItems(items)} />;
}

/** X on the focused row (or the one under the mouse), Esc to clear. Only while there are rows to pick from. */
export function BulkKeys({ items }: { items: BulkItem[] }) {
  const picked = usePicked();
  useEffect(() => syncItems(items), [items]);
  useKeys({
    x: () => {
      const row = document.activeElement?.closest("[data-bulk-row]") ?? document.querySelector("[data-bulk-row]:hover");
      const item = items.find((i) => i.candidateId === row?.getAttribute("data-bulk-row"));
      if (item) toggleItem(item);
    },
    ...(picked.size ? { Escape: () => clearPicked() } : {}),
  });
  useKeyHelp("CRM", [
    { keys: "X", label: "Select the row" },
    { keys: "Esc", label: "Clear the selection" },
  ]);
  return null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

const TITLES: Record<BulkAction, (n: number) => string> = {
  reject: (n) => `Reject ${plural(n, "application")}?`,
  tag: (n) => `Tag ${plural(n, "candidate")}`,
  pool: (n) => `Add ${plural(n, "candidate")} to a pool`,
};

const DONE: Record<BulkAction, (n: number) => string> = {
  reject: (n) => `Rejected ${plural(n, "application")}.`,
  tag: (n) => `Tagged ${plural(n, "candidate")}.`,
  pool: (n) => `Added ${plural(n, "candidate")} to the pool.`,
};

const UNCHANGED: Record<BulkAction, (n: number) => string> = {
  reject: (n) => `${plural(n, "was", "were")} already rejected.`,
  tag: (n) => `${plural(n, "already has", "already have")} it.`,
  pool: (n) => `${plural(n, "was", "were")} already in it.`,
};

/** The names a dialog asks about: the first few, then how many more. */
function names(items: BulkItem[]): string {
  const shown = items.slice(0, 6).map((i) => i.name);
  return items.length > shown.length ? `${shown.join(", ")} and ${items.length - shown.length} more` : shown.join(", ");
}

function Report({ action, summary, onClose }: { action: BulkAction; summary: BulkSummary; onClose: () => void }) {
  return (
    <div className="grid gap-3 p-4">
      <p className="m-0 text-[13.5px]" role="status">
        {[summary.done ? DONE[action](summary.done) : "No candidates were changed.", summary.unchanged ? UNCHANGED[action](summary.unchanged) : null].filter(Boolean).join(" ")}
      </p>
      {summary.problems.length ? (
        <div className="grid gap-1.5">
          <h3 className="m-0 text-[12.5px] font-medium text-muted-foreground">{plural(summary.problems.length, "row")} not changed</h3>
          <ul className="m-0 grid max-h-[320px] list-none gap-1 overflow-y-auto border border-[color:var(--line)] p-2">
            {summary.problems.map((p) => (
              <li key={p.id} className="grid gap-0.5 text-[13px]">
                <b className="truncate font-medium">{p.label}</b>
                <span className="text-[12.5px] text-muted-foreground">{p.sentence}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Button type="button" size="sm" onClick={onClose} className="justify-self-end">
        Done
      </Button>
    </div>
  );
}

function BulkDialog({ action, items, options, onClose }: { action: BulkAction; items: BulkItem[]; options: BulkOptions; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plan = rejectPlan(items);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const finish = (answer: BulkAnswer, labels: Map<string, string>) => {
    if (!answer.ok) return setError(BULK_ERRORS[answer.error]);
    setSummary(summarize(action, answer.rows, labels, action === "reject" ? plan.skipped : []));
    keepItems(retryPicked(action, items, answer.rows));
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      try {
        if (action === "reject") {
          const answer = await bulkRejectAction({
            applications: plan.apps.map((a) => ({ applicationId: a.applicationId, expectedStage: a.expectedStage })),
            reasonId: form.get("reasonId"),
            note: form.get("note"),
          });
          finish(answer, new Map(plan.apps.map((a) => [a.applicationId, a.label])));
        } else {
          const candidateIds = items.map((i) => i.candidateId);
          const send = action === "tag" ? bulkTagAction : bulkAddToPoolAction;
          finish(await send({ candidateIds, name: form.get("name") }), new Map(items.map((i) => [i.candidateId, i.name])));
        }
      } catch {
        // The run may have got part of the way: only a row's own answer says it did not.
        setError("The connection dropped, so some of these may have gone through. Check the table before trying again.");
      }
    });
  };

  const close = () => {
    if (!pending) onClose();
  };

  const count = action === "reject" ? plan.apps.length : items.length;
  const offerCount = plan.skipped.filter((s) => s.why === "at_offer").length;
  const openCount = plan.skipped.length - offerCount;
  const tooMany = action === "reject" && count > BULK_MAX;
  const title = TITLES[action](count);

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      // The browser lets a cancel be refused only once: a second Esc closes the dialog anyway.
      // Mid-run it comes straight back, or the report would land in a closed dialog; otherwise it is a close.
      onClose={() => (pending ? dialog.current?.showModal() : onClose())}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="m-auto w-[min(480px,calc(100vw-32px))] border border-[color:var(--line-strong)] bg-raised p-0 text-foreground shadow-[var(--pop-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      <div className="grid gap-0.5 border-b border-[color:var(--line)] px-4 py-3">
        <h2 className="m-0 text-[14px] font-semibold">{summary ? "What happened" : title}</h2>
        <p className="m-0 text-[12.5px] text-muted-foreground">{names(items)}</p>
      </div>
      {summary ? (
        <Report action={action} summary={summary} onClose={onClose} />
      ) : (
        <form onSubmit={submit} className="grid gap-3 p-4">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {action === "reject" ? (
            <>
              <p className="m-0 text-[13.5px] leading-[1.5] text-foreground/85">
                {count ? `Closes ${plural(count, "open application")} as rejected, in the jobs each row shows. No email goes to anyone.` : "Nobody selected has an application to reject here."}
                {openCount ? ` ${plural(openCount, "row")} left alone: nothing open to reject in this view.` : ""}
                {offerCount ? ` ${plural(offerCount, "application")} left alone: at offer, so reject them from their own page.` : ""}
              </p>
              {tooMany ? <Notice tone="error">{`That's more than ${BULK_MAX} applications at once. Unselect some.`}</Notice> : null}
              <label className="grid gap-1 text-[12.5px] text-muted-foreground">
                Reason
                <select name="reasonId" required defaultValue="" disabled={!options.reasons.length} className={selectClass}>
                  <option value="" disabled>
                    {options.reasons.length ? "Why are they rejected?" : "No reasons set up"}
                  </option>
                  {options.reasons.map((r) => (
                    <option key={r.reasonId} value={r.reasonId}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[12.5px] text-muted-foreground">
                Note (optional, on every application)
                <Input name="note" maxLength={NOTE_MAX} placeholder="Note" />
              </label>
            </>
          ) : (
            <label className="grid gap-1 text-[12.5px] text-muted-foreground">
              {action === "tag" ? "Tag" : "Talent pool"}
              <Input
                name="name"
                required
                autoComplete="off"
                list="bulk-names"
                placeholder={action === "tag" ? "Pick a tag, or type a new one" : "Pick a pool, or type a new one"}
              />
              <datalist id="bulk-names">
                {(action === "tag" ? options.tags : options.pools).map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || (action === "reject" && (!count || tooMany || !options.reasons.length))}>
              {pending ? "Working…" : action === "reject" ? `Reject ${count.toLocaleString("en-US")}` : action === "tag" ? `Tag ${count.toLocaleString("en-US")}` : `Add ${count.toLocaleString("en-US")}`}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** design/tats's `.bulk`, kept in view at the bottom of the table however far it scrolls. */
export function BulkBar({ options }: { options: BulkOptions }) {
  const picked = usePicked();
  const [open, setOpen] = useState<{ action: BulkAction; items: BulkItem[] } | null>(null);
  const start = (action: BulkAction) => setOpen({ action, items: [...picked.values()] });
  return (
    <>
      {picked.size ? (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="sticky bottom-[18px] z-[2] mx-auto my-2 flex w-fit max-w-[calc(100%-16px)] flex-wrap items-center gap-0.5 rounded-[12px] border border-[color:var(--line-strong)] bg-raised py-1 pr-1 pl-3 text-[13.5px] shadow-[var(--pop-shadow)]"
        >
          <span role="status" className="mr-1.5 font-medium tabular-nums">
            {picked.size.toLocaleString("en-US")} selected
          </span>
          {picked.size >= BULK_MAX ? <span className="mr-1.5 text-[12.5px] text-faint">{BULK_MAX} is the most at once</span> : null}
          <Button type="button" variant="ghost" size="sm" onClick={() => start("reject")}>
            Reject…
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => start("tag")}>
            Tag…
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => start("pool")}>
            Add to pool…
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearPicked} aria-label="Clear the selection" title="Clear the selection (Esc)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="size-3.5" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </Button>
        </div>
      ) : null}
      {open ? <BulkDialog action={open.action} items={open.items} options={options} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
