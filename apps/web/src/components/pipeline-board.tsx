"use client";

import Link from "next/link";
import { hoverAttr } from "@/lib/hover-card";
import { useOptimistic, useState, useTransition } from "react";
import type { PipelineCard } from "@tacit/core";
import { Pill, STAGE_GLYPH, StatusGlyph } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A pipeline as a board: one column per live stage, plus one for the three
 * outcomes. One role's candidates on /roles/[id], or every role of a company
 * on /pipeline (`showRole`), which is why each card carries its own role. Drag a card to a column to move it (the stage `<select>` in
 * the card's edit form does the same without a mouse). The stage lists arrive
 * as props from the server page, which reads them from `@tacit/core` -- this
 * file imports core for types only, so its server code stays out of the
 * browser bundle.
 *
 * A copy of tacit-internal's staff board (apps/internal), used by
 * /client/jobs/[id]. It imports no server actions and no links of its own: each page passes the
 * actions that act as its user, and where a person or a role links to.
 * Without `actions` the board is read-only.
 *
 * Drawn in Testbench's staff design: each column a recessed well headed by its
 * stage's square (STAGE_GLYPH), the name in sentence case and the count; each
 * card white with a soft shadow, a stalled one ringed in red with its reasons as
 * red tags; facts stand apart on spacing, never between dots.
 */

export type PipelineBoardActions = {
  /** A card dropped on a column. */
  move: (applicationId: string, stage: string, roleId: string) => Promise<void>;
  /** The card's edit form: applicationId, roleId, stage, ownerActorId, nextAction, due. */
  update: (formData: FormData) => Promise<void>;
  /** applicationId, roleId, note. */
  logTouch: (formData: FormData) => Promise<void>;
  /** applicationId, roleId. */
  remove: (formData: FormData) => Promise<void>;
};

/** Where names link: `${person}/${personId}` and `${role}/${roleId}`. Omit one for plain text. */
export type PipelineBoardLinks = { person?: string; role?: string };

const STALLED_COPY: Record<string, string> = {
  no_touch: "No touch in a week",
  overdue: "Next action overdue",
};

/** A stage key as a label: "interviewing" reads "Interviewing". */
const stageWord = (stage: string) => {
  const s = stage.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const LABEL = "grid gap-1.5 text-[12.5px] text-muted-foreground";

/** "today", "3d ago", "5w ago". `now` comes from the server render so the
 * first paint and hydration agree. */
function ago(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days < 14) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

type Owner = { actorId: string; name: string };

export type BoardCard = PipelineCard & { roleId: string; roleTitle: string };

function CardView({
  card,
  showRole,
  owners,
  stages,
  now,
  actions,
  links,
  onDragStart,
}: {
  card: BoardCard;
  showRole: boolean;
  owners: Owner[];
  stages: readonly string[];
  now: number;
  actions?: PipelineBoardActions;
  links: PipelineBoardLinks;
  onDragStart: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const stalled = card.stalled.length > 0;
  const roleId = card.roleId;
  const editable = actions !== undefined;

  return (
    <div
      draggable={editable && !open}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.applicationId);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(card.applicationId);
      }}
      className={cn(
        "rounded-[10px] bg-[color:var(--paper)] p-3 text-[12.5px] transition-shadow",
        stalled ? "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--red)_45%,transparent),var(--shadow-sm)]" : "shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow)]",
        editable && !open && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {links.person ? (
          <Link
            href={`${links.person}/${card.personId}`}
            data-hc={hoverAttr("candidate", card.personId)}
            className="text-[13px] leading-5 font-medium [overflow-wrap:anywhere] hover:underline hover:underline-offset-[3px]"
          >
            {card.personName}
          </Link>
        ) : (
          <span data-hc={hoverAttr("candidate", card.personId)} className="text-[13px] leading-5 font-medium [overflow-wrap:anywhere]">
            {card.personName}
          </span>
        )}
        {editable && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="-mt-1 -mr-1.5 h-7 px-2 text-[12px]">
            {open ? "Close" : "Edit"}
          </Button>
        )}
      </div>
      {card.headline && <p className="m-0 mt-0.5 text-faint">{card.headline}</p>}
      {/* An agency's submission (Tacit's reads "Tacit · <teammate>"): who sent them. */}
      {card.source === "agency" && <Pill className="mt-2">{card.sourceDetail ?? "Agency"}</Pill>}
      {showRole &&
        (links.role ? (
          <Link
            href={`${links.role}/${roleId}`}
            className="mt-2 inline-flex h-6 items-center rounded-[6px] bg-[color:var(--soft-strong)] px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {card.roleTitle}
          </Link>
        ) : (
          <span className="mt-2 inline-flex h-6 items-center rounded-[6px] bg-[color:var(--soft-strong)] px-2 text-[12px] text-muted-foreground">{card.roleTitle}</span>
        ))}

      {stalled && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.stalled.map((reason) => (
            <Pill key={reason} tone="red">
              <StatusGlyph kind="alert" className="size-3" />
              {STALLED_COPY[reason] ?? reason}
            </Pill>
          ))}
        </div>
      )}

      {card.nextAction && (
        <p className="m-0 mt-2 text-[12.5px] leading-[18px]">
          <span className="text-faint">Next: </span>
          {card.nextAction}
          {card.nextActionDue && <span className="ml-2 whitespace-nowrap text-faint tabular-nums">by {card.nextActionDue}</span>}
        </p>
      )}

      <p className="m-0 mt-2 flex flex-wrap gap-x-3 text-[12px]">
        <span className={card.ownerName ? "text-muted-foreground" : "text-faint"}>{card.ownerName ?? "Unowned"}</span>
        <span className="text-faint">Touched {ago(card.lastTouchAt, now)}</span>
      </p>

      {actions && open && (
        <div className="mt-3 grid gap-4 border-t border-[color:var(--line)] pt-3">
          <form action={actions.update} className="grid gap-2.5">
            <input type="hidden" name="applicationId" value={card.applicationId} />
            <input type="hidden" name="roleId" value={roleId} />
            <div className="grid grid-cols-2 gap-2">
              <label className={LABEL}>
                Stage
                <select name="stage" defaultValue={card.stage} className={cn(selectClass, "px-2")}>
                  {stages.map((s) => (
                    <option key={s} value={s}>
                      {stageWord(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                Owner
                <select name="ownerActorId" defaultValue={card.ownerActorId ?? ""} className={cn(selectClass, "px-2")}>
                  <option value="">Unowned</option>
                  {owners.map((o) => (
                    <option key={o.actorId} value={o.actorId}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={LABEL}>
              Next action
              <Input name="nextAction" defaultValue={card.nextAction ?? ""} placeholder="e.g. send take-home" />
            </label>
            <label className={LABEL}>
              Due
              <Input type="date" name="due" defaultValue={card.nextActionDue ?? ""} />
            </label>
            <SubmitButton variant="outline" size="sm" pendingLabel="Saving…" className="justify-self-start">
              Save
            </SubmitButton>
          </form>

          <form action={actions.logTouch} className="grid gap-2.5">
            <input type="hidden" name="applicationId" value={card.applicationId} />
            <input type="hidden" name="roleId" value={roleId} />
            <label className={LABEL}>
              Log a touch
              <Input name="note" placeholder="Optional note: what happened" />
            </label>
            <SubmitButton variant="outline" size="sm" pendingLabel="Logging…" className="justify-self-start">
              Log touch
            </SubmitButton>
          </form>

          <form action={actions.remove}>
            <input type="hidden" name="applicationId" value={card.applicationId} />
            <input type="hidden" name="roleId" value={roleId} />
            <button type="submit" className="text-[12px] text-muted-foreground underline decoration-[color:var(--line-strong)] underline-offset-[3px] transition-colors hover:text-negative hover:decoration-current">
              Remove from pipeline (added by mistake)
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function PipelineBoard({
  cards,
  showRole = false,
  owners,
  activeStages,
  closedStages,
  now,
  actions,
  links = { person: "/people", role: "/roles" },
}: {
  cards: BoardCard[];
  /** Name the role on each card: for a board that spans several roles. */
  showRole?: boolean;
  owners: Owner[];
  activeStages: readonly string[];
  closedStages: readonly string[];
  now: number;
  /** The writes, acting as the page's user. Omit for a read-only board. */
  actions?: PipelineBoardActions;
  links?: PipelineBoardLinks;
}) {
  const [, startTransition] = useTransition();
  const [optimistic, move] = useOptimistic(cards, (state, m: { id: string; stage: string }) =>
    state.map((c) => (c.applicationId === m.id ? ({ ...c, stage: m.stage } as BoardCard) : c)),
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const stages = [...activeStages, ...closedStages];

  // A drop on the Closed column needs to know WHICH outcome, so that column
  // is three drop targets, not one.
  const columns: { key: string; label: string; targets: readonly string[] }[] = [
    ...activeStages.map((s) => ({ key: s, label: s, targets: [s] })),
    { key: "closed", label: "closed", targets: closedStages },
  ];

  function drop(stage: string) {
    const id = dragging;
    setDragging(null);
    setOver(null);
    if (!id) return;
    const card = optimistic.find((c) => c.applicationId === id);
    if (!actions || !card || card.stage === stage) return;
    startTransition(async () => {
      move({ id, stage });
      await actions.move(id, stage, card.roleId);
    });
  }

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div className="flex min-w-max gap-2.5">
        {columns.map((col) => {
          const inColumn = optimistic.filter((c) => col.targets.includes(c.stage));
          return (
            <div key={col.key} className="w-64 shrink-0">
              <div className="mb-1.5 flex h-8 items-center gap-2 px-2">
                <StatusGlyph kind={STAGE_GLYPH[col.key] ?? "closed"} />
                <h3 className="m-0 font-mono text-[13px] font-medium tracking-normal">{stageWord(col.label)}</h3>
                <span className="text-faint tabular-nums">{inColumn.length}</span>
              </div>
              <div className="grid gap-2">
                {col.targets.map((stage) => {
                  const here = inColumn.filter((c) => c.stage === stage);
                  const isOver = over === stage && dragging !== null;
                  return (
                    <div
                      key={stage}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setOver(stage);
                      }}
                      onDragLeave={() => setOver((o) => (o === stage ? null : o))}
                      onDrop={(e) => {
                        e.preventDefault();
                        drop(stage);
                      }}
                      className={cn(
                        "grid content-start gap-1.5 rounded-[12px] p-1.5 transition-[background-color,box-shadow] duration-200 ease-[var(--ease-out)]",
                        col.targets.length === 1 ? "min-h-32" : "min-h-12",
                        isOver ? "bg-[color:var(--accent-soft)] shadow-[inset_0_0_0_1.5px_var(--accent)]" : "bg-[color:var(--soft)] shadow-[inset_0_0_0_1px_var(--line)]",
                      )}
                    >
                      {col.targets.length > 1 && (
                        <p className="m-0 flex h-6 items-center gap-2 px-1.5 text-[12px] text-muted-foreground">
                          <StatusGlyph kind={STAGE_GLYPH[stage] ?? "closed"} className="size-3" />
                          {stageWord(stage)}
                          <span className="text-faint tabular-nums">{here.length}</span>
                        </p>
                      )}
                      {here.map((card) => (
                        <CardView
                          key={card.applicationId}
                          card={card}
                          showRole={showRole}
                          owners={owners}
                          stages={stages}
                          now={now}
                          actions={actions}
                          links={links}
                          onDragStart={setDragging}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
