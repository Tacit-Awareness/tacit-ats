"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import type { PipelineCard } from "@tacit/core";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
 * A copy of Tacit-Awareness's staff board, used by /client/jobs/[id]. It
 * imports no server actions and no links of its own: each page passes the
 * actions that act as its user, and where a person or a role links to.
 * Without `actions` the board is read-only.
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
  no_touch: "no touch in a week",
  overdue: "next action overdue",
};

const selectClass = "field h-[34px] w-full rounded-[10px] bg-[position:right_9px_center] pr-6 pl-2.5 text-[13px]";

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
        "rounded-[14px] bg-card p-3.5 text-sm transition-shadow duration-150",
        stalled
          ? "shadow-[0_0_0_1px_rgb(180_35_24/0.22),0_1px_2px_rgb(24_24_27/0.04)]"
          : "shadow-[var(--glass-shadow)] hover:shadow-[var(--glass-lift)]",
        editable && !open && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {links.person ? (
          <Link href={`${links.person}/${card.personId}`} className="font-medium hover:underline">
            {card.personName}
          </Link>
        ) : (
          <span className="font-medium">{card.personName}</span>
        )}
        {editable && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="-mr-1.5 -mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[13px] text-primary transition-colors hover:bg-[rgb(29_111_165/0.07)]"
            aria-expanded={open}
          >
            {open ? "Close" : "Edit"}
          </button>
        )}
      </div>
      {card.headline && <p className="mt-0.5 text-[13px] text-muted-foreground">{card.headline}</p>}
      {showRole &&
        (links.role ? (
          <Link
            href={`${links.role}/${roleId}`}
            className="mt-1.5 inline-block rounded-full bg-[rgb(24_24_27/0.05)] px-2 py-0.5 text-xs text-text hover:text-foreground"
          >
            {card.roleTitle}
          </Link>
        ) : (
          <span className="mt-1.5 inline-block rounded-full bg-[rgb(24_24_27/0.05)] px-2 py-0.5 text-xs text-text">
            {card.roleTitle}
          </span>
        ))}

      {stalled && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.stalled.map((reason) => (
            <Badge key={reason} variant="negative">
              {STALLED_COPY[reason] ?? reason}
            </Badge>
          ))}
        </div>
      )}

      {card.nextAction && (
        <p className="mt-2 text-[13px] text-text">
          <span className="text-muted-foreground">Next: </span>
          {card.nextAction}
          {card.nextActionDue && (
            <span className="font-mono text-xs text-muted-foreground"> · by {card.nextActionDue}</span>
          )}
        </p>
      )}

      <p className="mt-2.5 font-mono text-[11px] text-faint">
        {card.ownerName ?? "unowned"} · touched {ago(card.lastTouchAt, now)}
      </p>

      {actions && open && (
        <div className="mt-3 space-y-3.5 border-t border-border pt-3.5">
          <form action={actions.update} className="space-y-2">
            <input type="hidden" name="applicationId" value={card.applicationId} />
            <input type="hidden" name="roleId" value={roleId} />
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs font-medium text-text">
                Stage
                <select name="stage" defaultValue={card.stage} className={cn(selectClass, "capitalize")}>
                  {stages.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs font-medium text-text">
                Owner
                <select name="ownerActorId" defaultValue={card.ownerActorId ?? ""} className={selectClass}>
                  <option value="">unowned</option>
                  {owners.map((o) => (
                    <option key={o.actorId} value={o.actorId}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block space-y-1 text-xs font-medium text-text">
              Next action
              <Input name="nextAction" defaultValue={card.nextAction ?? ""} placeholder="e.g. send take-home" />
            </label>
            <label className="block space-y-1 text-xs font-medium text-text">
              Due
              <Input type="date" name="due" defaultValue={card.nextActionDue ?? ""} />
            </label>
            <SubmitButton variant="outline" size="sm" pendingLabel="Saving…">
              Save
            </SubmitButton>
          </form>

          <form action={actions.logTouch} className="space-y-2">
            <input type="hidden" name="applicationId" value={card.applicationId} />
            <input type="hidden" name="roleId" value={roleId} />
            <label className="block space-y-1 text-xs font-medium text-text">
              Log a touch
              <Input name="note" placeholder="optional note: what happened" />
            </label>
            <SubmitButton variant="outline" size="sm" pendingLabel="Logging…">
              Log touch
            </SubmitButton>
          </form>

          <form action={actions.remove}>
            <input type="hidden" name="applicationId" value={card.applicationId} />
            <input type="hidden" name="roleId" value={roleId} />
            <button type="submit" className="text-xs text-muted-foreground underline-offset-[3px] transition-colors hover:text-negative hover:underline">
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
    <div className="-mx-1 overflow-x-auto px-1 pt-1 pb-3">
      <div className="flex min-w-max gap-3">
        {columns.map((col) => {
          const inColumn = optimistic.filter((c) => col.targets.includes(c.stage));
          return (
            <div key={col.key} className="w-64 shrink-0">
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h3 className="text-[15px] capitalize text-foreground">{col.label}</h3>
                <span className="font-mono text-xs text-faint">{inColumn.length}</span>
              </div>
              <div className="space-y-2">
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
                        "space-y-2 rounded-[18px] p-2 transition-[background-color,box-shadow] duration-150",
                        col.targets.length === 1 ? "min-h-32" : "min-h-12",
                        isOver
                          ? "bg-primary-soft shadow-[inset_0_0_0_1px_rgb(29_111_165/0.45)]"
                          : "bg-[rgb(24_24_27/0.035)] shadow-[inset_0_0_0_1px_rgb(24_24_27/0.04)]",
                      )}
                    >
                      {col.targets.length > 1 && (
                        <p className="px-1.5 pt-0.5 text-xs capitalize text-muted-foreground">
                          {stage} · {here.length}
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
