"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useViews } from "@/components/app-shell/shell-memory";
import { Page, PageBar } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SOURCE_GROUPS, type SourceGroup } from "@/lib/client/analytics-metrics";
import { PIPELINE_COLUMNS, isColumnKey, type ColumnKey } from "@/lib/client/pipeline-columns";
import type { ViewsRead } from "@/lib/client/views";
import { VIEWS_MAX, VIEW_NAME_MAX, allViews, describeFilters, viewHref, viewKeeps, type SavedView } from "@/lib/saved-views";
import { cn } from "@/lib/utils";

// The Views page's markup, as design/tats's: Pages, then Saved views, a row
// each with its icon, name, count and a pin that shows on hover (and always on
// a touch screen or once pinned). Counts run here because only this browser
// knows the views, over the rows page.tsx read. New view is the prototype's
// form, in a `<dialog>`: the browser gives it the top layer, the focus trap and
// Escape. A row a member made can be removed, which the prototype has no way to
// do.

const PAGES = [
  { href: "/client/schedule", name: "Calendar", desc: "Interviews and holds by week", icon: "M3 4h10v9H3ZM3 7h10M6 2.5v3M10 2.5v3" },
  { href: "/client/interviewers", name: "Interviewers", desc: "Who interviews, and their load", icon: "M6 7.5a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6M1.8 13c.4-2.3 2-3.6 4.2-3.6s3.8 1.3 4.2 3.6M11 3.2a2.2 2.2 0 0 1 0 4.1M12.6 9.8c1 .6 1.6 1.7 1.8 3.2" },
] as const;
const LAYERS = "M8 2.5 14 5.5 8 8.5 2 5.5ZM2 8.5l6 3 6-3M2 11.5l6 3 6-3";
const TACK = "M9.8 2.5 13.5 6.2 11.6 7.1 9.6 9.1l.4 3-1 1L3.9 8l1-1 3 .4 2-2ZM6.4 10.6 2.5 14.5";

const selectClass =
  "h-8 w-full border border-input bg-card px-2 text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

function Glyph({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className={cn("size-[15px]", className)} aria-hidden>
      <path d={d} />
    </svg>
  );
}

function Band({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="overflow-hidden border border-[color:var(--line)] bg-[color:var(--paper)]">
      <h2 className="m-0 border-b border-[color:var(--line-strong)] bg-[color:var(--surface)] px-[18px] pt-3.5 pb-2.5 text-[14px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A row is one link, stretched over it; the pin and remove buttons sit above the stretch. */
function Row({ href, icon, name, desc, count, children }: { href: string; icon: string; name: string; desc: string; count?: string; children?: React.ReactNode }) {
  return (
    <div className="group relative grid min-h-14 grid-cols-[28px_minmax(0,1fr)_auto_32px_32px] items-center gap-x-3 border-b border-[color:var(--line)] py-1.5 pr-3 pl-[18px] transition-colors last:border-b-0 hover:bg-[color:var(--hover)] max-sm:grid-cols-[28px_minmax(0,1fr)_32px_32px]">
      <span className="grid size-7 place-items-center bg-[color:var(--soft)] text-muted-foreground">
        <Glyph d={icon} />
      </span>
      <Link href={href} title={desc} className="truncate text-[14px] font-medium outline-none after:absolute after:inset-0 focus-visible:underline">
        {name}
      </Link>
      <span className="text-[12.5px] whitespace-nowrap text-faint tabular-nums max-sm:hidden">{count}</span>
      {children ?? (
        <>
          <span />
          <span />
        </>
      )}
    </div>
  );
}

const ghost = "relative z-10 grid size-[30px] place-items-center rounded-full text-faint transition-[opacity,background-color,color] hover:bg-[color:var(--soft-strong)] hover:text-foreground [@media(hover:none)]:opacity-100 group-hover:opacity-100 focus-visible:opacity-100";

function NewView({ onClose, departments, tags }: { onClose: () => void } & Pick<ViewsRead, "departments" | "tags">) {
  const { add } = useViews();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    // No close() on cleanup: its `close` event would end the dialog as it opens under Strict Mode. Unmounting removes it.
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "");
    const stage = text("stage");
    const filters = {
      department: text("department") || null,
      stage: isColumnKey(stage) ? (stage as ColumnKey) : null,
      source: (text("source") || null) as SourceGroup | null,
      tag: text("tag") || null,
    };
    const made = add({
      ...filters,
      name: text("name"),
      pin: f.get("pin") === "on",
      desc: describeFilters(filters, { department: departments.find((d) => d.id === filters.department)?.path, tag: tags.find((t) => t.id === filters.tag)?.name }),
    });
    if (!made) return setProblem(text("name").trim() ? `You can have ${VIEWS_MAX} views. Remove one first.` : "A view needs a name.");
    onClose();
    router.push(viewHref(made));
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="new-view-title"
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      className="m-auto w-[calc(100%-32px)] max-w-[460px] border border-[color:var(--line-strong)] bg-raised p-0 text-foreground shadow-[var(--pop-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      <form onSubmit={submit} className="grid gap-3.5 p-5">
        <div>
          <h2 id="new-view-title" className="m-0 text-[15px] font-medium">
            New view
          </h2>
          <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">A saved filter on the Pipeline.</p>
        </div>
        <label className="grid gap-1 text-[12.5px] text-muted-foreground">
          Name
          <Input name="name" placeholder="Referrals in infra" required maxLength={VIEW_NAME_MAX} autoFocus onChange={() => setProblem(null)} />
        </label>
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          {departments.length ? (
            <label className="grid gap-1 text-[12.5px] text-muted-foreground">
              Department
              <select name="department" className={selectClass}>
                <option value="">Any department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.path}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1 text-[12.5px] text-muted-foreground">
            Stage
            <select name="stage" className={selectClass}>
              <option value="">Any stage</option>
              {PIPELINE_COLUMNS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12.5px] text-muted-foreground">
            Source
            <select name="source" className={selectClass}>
              <option value="">Any source</option>
              {SOURCE_GROUPS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {tags.length ? (
            <label className="grid gap-1 text-[12.5px] text-muted-foreground">
              Label
              <select name="tag" className={selectClass}>
                <option value="">Any label</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-[13.5px]">
          <input type="checkbox" name="pin" defaultChecked className="size-4 accent-[color:var(--accent)]" />
          Pin to sidebar
        </label>
        {problem ? (
          <p role="alert" className="m-0 text-[13px] text-negative">
            {problem}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Create view
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export function ViewsView({ rows, departments, tags, capped }: ViewsRead) {
  const { state, kept, togglePin, remove } = useViews();
  const [creating, setCreating] = useState(false);
  const roles = useMemo(() => new Map(departments.map((d) => [d.id, new Set(d.roleIds)])), [departments]);
  const count = (v: SavedView) => {
    const n = rows.filter((r) => viewKeeps(v, r, (v.department && roles.get(v.department)) || null)).length;
    return `${n.toLocaleString("en-US")} applicant${n === 1 ? "" : "s"}`;
  };

  return (
    <Page
      narrow
      bar={
        <PageBar title="Views">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:var(--line)] bg-[color:var(--paper)] px-2.5 text-[12.5px] transition-colors hover:border-[color:var(--line-strong)]"
          >
            <Glyph d="M8 3.5v9M3.5 8h9" className="size-[13px]" />
            New view
          </button>
        </PageBar>
      }
    >
      <Band title="Pages">
        {PAGES.map((p) => (
          <Row key={p.href} href={p.href} icon={p.icon} name={p.name} desc={p.desc} />
        ))}
      </Band>
      <Band title="Saved views">
        {allViews(state).map((v) => {
          const pinned = state.pins.includes(v.id);
          return (
            <Row key={v.id} href={viewHref(v)} icon={LAYERS} name={v.name} desc={v.desc} count={count(v)}>
              <button
                type="button"
                onClick={() => togglePin(v.id)}
                aria-pressed={pinned}
                aria-label={`${pinned ? "Unpin" : "Pin"} ${v.name}`}
                title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                className={cn(ghost, pinned ? "text-foreground opacity-100" : "opacity-0")}
              >
                <Glyph d={TACK} className={pinned ? "fill-current" : undefined} />
              </button>
              {v.id.startsWith("v") ? (
                <button type="button" onClick={() => remove(v.id)} aria-label={`Remove ${v.name}`} title="Remove view" className={cn(ghost, "opacity-0")}>
                  <Glyph d="M4 4l8 8M12 4l-8 8" />
                </button>
              ) : (
                <span />
              )}
            </Row>
          );
        })}
      </Band>
      {capped ? <p className="m-0 text-[12.5px] text-faint">A job has more than 1,000 applications, so these counts may stop short.</p> : null}
      {kept ? null : <p className="m-0 text-[12.5px] text-faint">This browser isn&apos;t keeping views, so your pins and new views will be gone when you reload.</p>}
      {creating ? <NewView onClose={() => setCreating(false)} departments={departments} tags={tags} /> : null}
    </Page>
  );
}
