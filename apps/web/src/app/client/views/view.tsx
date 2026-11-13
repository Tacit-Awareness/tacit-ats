"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useViews } from "@/components/app-shell/shell-memory";
import { Notice, Page, PageBar, Section } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import { SOURCE_GROUPS, type SourceGroup } from "@/lib/client/analytics-metrics";
import { PIPELINE_COLUMNS, isColumnKey, type ColumnKey } from "@/lib/client/pipeline-columns";
import type { ViewsRead } from "@/lib/client/views";
import { VIEWS_MAX, VIEW_NAME_MAX, allViews, describeFilters, viewHref, viewKeeps, type SavedView } from "@/lib/saved-views";
import { cn } from "@/lib/utils";

// The Views page's markup, as design/tats's drawn in Testbench's staff design:
// two white cards, Pages, then Saved views, a row each with its icon, name,
// count and a pin that shows on hover or keyboard focus (and always on a touch
// screen or once pinned). Counts run here because only this browser knows the
// views, over the rows page.tsx read. New view is the prototype's form, in a
// Testbench dialog on a `<dialog>`: the browser gives it the top layer, the
// focus trap and Escape. A row a member made can be removed, which the
// prototype has no way to do.

const PAGES = [
  { href: "/client/schedule", name: "Interview Calendar", desc: "Interviews and holds by week", icon: "M3 4h10v9H3ZM3 7h10M6 2.5v3M10 2.5v3" },
  { href: "/client/interviewers", name: "Interviewers", desc: "Who interviews, and their load", icon: "M6 7.5a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6M1.8 13c.4-2.3 2-3.6 4.2-3.6s3.8 1.3 4.2 3.6M11 3.2a2.2 2.2 0 0 1 0 4.1M12.6 9.8c1 .6 1.6 1.7 1.8 3.2" },
] as const;
const LAYERS = "M8 2.5 14 5.5 8 8.5 2 5.5ZM2 8.5l6 3 6-3M2 11.5l6 3 6-3";
const TACK = "M9.8 2.5 13.5 6.2 11.6 7.1 9.6 9.1l.4 3-1 1L3.9 8l1-1 3 .4 2-2ZM6.4 10.6 2.5 14.5";

function Glyph({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className={cn("size-[15px]", className)} aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** A white card with its Mona Sans heading in a ruled row, the rows edge to edge under it. */
function Band({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Section aria-label={title} title={title} flush>
      {children}
    </Section>
  );
}

/** A row is one link, stretched over it; the pin and remove buttons sit above the stretch. The icon stands bare, no tile. */
function Row({ href, icon, name, desc, count, children }: { href: string; icon: string; name: string; desc: string; count?: string; children?: React.ReactNode }) {
  return (
    <div className="group relative grid h-12 grid-cols-[16px_minmax(0,1fr)_auto_30px_30px] items-center gap-x-3.5 border-b border-[color:var(--line)] pr-3 pl-5 text-[13px] transition-colors last:border-b-0 hover:bg-[color:var(--surface)] has-[a:focus-visible]:bg-[color:var(--sel)] max-sm:grid-cols-[16px_minmax(0,1fr)_30px_30px]">
      <Glyph d={icon} className="text-faint" />
      <Link href={href} title={desc} className="truncate font-medium outline-none after:absolute after:inset-0 focus-visible:underline">
        {name}
      </Link>
      <span className="text-[12px] whitespace-nowrap text-faint tabular-nums max-sm:hidden">{count}</span>
      {children ?? (
        <>
          <span />
          <span />
        </>
      )}
    </div>
  );
}

const ghost = cn(
  buttonVariants({ variant: "ghost", size: "sm" }),
  "relative z-10 size-[30px] px-0 text-faint transition-[opacity,background-color,color] group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
);

const LABEL = "grid gap-1.5 text-[12.5px] text-muted-foreground";

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
      className="m-auto w-[calc(100%-32px)] max-w-[520px] overflow-hidden rounded-[16px] border-0 bg-[color:var(--surface)] p-0 text-foreground shadow-[var(--box-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      {/* Testbench's `.dialog`: a Mona Sans title, the body 24px in, the buttons right over a hairline. */}
      <form onSubmit={submit} className="grid">
        <h2 id="new-view-title" title="A saved filter on the Pipeline" className="m-0 px-6 pt-[22px] pb-1.5 text-[20px] leading-[26px] font-semibold tracking-[-0.015em]">
          New view
        </h2>
        <div className="grid gap-4 px-6 pt-3 pb-5">
          <label className={LABEL}>
            Name
            <Input name="name" placeholder="Referrals in infra" required maxLength={VIEW_NAME_MAX} autoFocus onChange={() => setProblem(null)} />
          </label>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            {departments.length ? (
              <label className={LABEL}>
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
            <label className={LABEL}>
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
            <label className={LABEL}>
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
              <label className={LABEL}>
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
          <label className="flex items-center gap-2.5 text-[13px]">
            <input type="checkbox" name="pin" defaultChecked className="size-4" />
            Pin to sidebar
          </label>
          {problem ? (
            <p role="alert" className="m-0 text-[13px] text-negative">
              {problem}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[color:var(--line)] px-6 py-3.5">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Create view</Button>
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
          <Button type="button" variant="outline" onClick={() => setCreating(true)}>
            <Glyph d="M8 3.5v9M3.5 8h9" />
            New view
          </Button>
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
      {capped ? <Notice>A job has more than 1,000 applications, so these counts may stop short.</Notice> : null}
      {kept ? null : <Notice>This browser isn&apos;t keeping views, so your pins and new views will be gone when you reload.</Notice>}
      {creating ? <NewView onClose={() => setCreating(false)} departments={departments} tags={tags} /> : null}
    </Page>
  );
}
