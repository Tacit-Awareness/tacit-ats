"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import type { PipelineCard } from "@tacit/core";
import { Pill } from "@/components/page";
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
 * A copy of tacit-internal's staff board (apps/internal), used by
 * /client/jobs/[id]. It imports no server actions and no links of its own: each page passes the
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

const selectClass =
  "h-8 w-full rounded-md border border-input bg-card px-2 text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

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
        "rounded-lg border bg-card p-3 text-sm shadow-[0_1px_2px_rgba(32,32,30,0.04)]",
        stalled ? "border-negative/40" : "border-[color:var(--card-border)]",
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
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={open}
          >
            {open ? "Close" : "Edit"}
          </button>
        )}
      </div>
      {card.headline && <p className="mt-0.5 text-xs text-muted-foreground">{card.headline}</p>}
      {/* An agency's submission (Tacit's reads "Tacit · <teammate>"): who sent them. */}
      {card.source === "agency" && (
        <Pill className="mt-1.5">
          {card.sourceDetail ?? "Agency"}
        </Pill>
      )}
      {showRole &&
        (links.role ? (
          <Link
            href={`${links.role}/${roleId}`}
            className="mt-1.5 inline-block rounded-md bg-[color:var(--soft)] px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {card.roleTitle}
          </Link>
        ) : (
          <span className="mt-1.5 inline-block rounded-md bg-[color:var(--soft)] px-1.5 py-0.5 text-[11px] text-muted-foreground">
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
        <p className="mt-2 text-[13px]">
          <span className="text-muted-foreground">Next: </span>
          {card.nextAction}
          {card.nextActionDue && (
            <span className="font-mono text-xs text-muted-foreground"> · by {card.nextActionDue}</span>
          )}
        </p>
      )}

      <p className="mt-2 font-mono text-[11px] text-muted-foreground/80">
        {card.ownerName ?? "unowned"} · touched {ago(card.lastTouchAt, now)}
      </p>

      {actions && open && (
        <div className="mt-3 space-y-3 border-t border-[color:var(--line)] pt-3">
          <form action={actions.update} className="space-y-2">
            <input type="hidden" name="applicationId" value={card.applicationId} />
            <input type="hidden" name="roleId" value={roleId} />
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                Stage
                <select name="stage" defaultValue={card.stage} className={cn(selectClass, "capitalize")}>
                  {stages.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
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
            <label className="block space-y-1 text-xs text-muted-foreground">
              Next action
              <Input name="nextAction" defaultValue={card.nextAction ?? ""} placeholder="e.g. send take-home" />
            </label>
            <label className="block space-y-1 text-xs text-muted-foreground">
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
            <label className="block space-y-1 text-xs text-muted-foreground">
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
            <button type="submit" className="text-xs text-muted-foreground underline-offset-4 hover:text-negative hover:underline">
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
      <div className="flex min-w-max gap-3">
        {columns.map((col) => {
          const inColumn = optimistic.filter((c) => col.targets.includes(c.stage));
          return (
            <div key={col.key} className="w-64 shrink-0">
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {col.label}
                </h3>
                <span className="font-mono text-xs text-muted-foreground/70">{inColumn.length}</span>
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
                        "space-y-2 rounded-lg border border-dashed p-2 transition-colors",
                        col.targets.length === 1 ? "min-h-32" : "min-h-12",
                        isOver ? "border-primary bg-primary-soft" : "border-[color:var(--line)] bg-[color:var(--soft)]",
                      )}
                    >
                      {col.targets.length > 1 && (
                        <p className="px-1 text-[11px] capitalize text-muted-foreground">
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
