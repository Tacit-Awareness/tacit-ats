"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { ChevronsDown, ChevronsUp, FileText } from "lucide-react";
import { Kbd, useMod } from "@/components/tickets/kit";
import type { Reply } from "../applicants/reply-box";
import type { MoveKey, Routing } from "../applicants/routing-bar";
import { draftReplyAction, routeApplicantAction, sendReplyAction } from "../applicants/actions";

// Triage's bottom bar (design/tacit-tickets's Triage composer) on New Applicants'
// own writes, which come back to Triage (lib/client/triage-return.ts). The
// prototype's one Send both routes and emails; here they stay two writes, as on
// New Applicants (applicants/control-panel.tsx): a route can land while a reply
// is refused and the reverse, and a reply is always two steps, Review Draft then
// Send, so the member reads the stored draft before anything goes out.
// - The move picks the reply's starter: Interview, Testbench (only where the
//   reply can carry the candidate's own invite link) and Decline, as I, T, D.
// - Decline needs one of the org's rejection reasons, chosen in the card.
// - The team is the job's, a fact: a route takes no team.
// - Left out: the prototype's grade (no grade field; its note would be a third
//   write), picking another team (routing takes none), Revisit.

const MOVES: { key: MoveKey; label: string; hint: string }[] = [
  { key: "interview", label: "Interview", hint: "I" },
  { key: "testbench", label: "Testbench", hint: "T" },
  { key: "decline", label: "Decline", hint: "D" },
];

const MINI_KEY = "tacit-triage-mini";

function Submit({ children, solid, disabled, formId, title }: { children: React.ReactNode; solid?: boolean; disabled?: boolean; formId?: string; title?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      form={formId}
      title={title}
      disabled={disabled || pending}
      className={
        solid
          ? "flex h-8 items-center gap-2 rounded-lg bg-ink px-3.5 font-medium text-well transition-opacity hover:opacity-90 disabled:opacity-30"
          : "flex h-8 items-center gap-2 rounded-lg border border-line-strong px-3 text-ink transition-colors hover:bg-hover disabled:opacity-30"
      }
    >
      {children}
    </button>
  );
}

export function TriageComposer({ name, routing, reply, team, laterHref }: { name: string; routing: Routing | null; reply: Reply | null; team: string | null; laterHref: string | null }) {
  const mod = useMod("↵");
  const offered = MOVES.filter((m) => m.key !== "testbench" || reply?.testbench === true);
  const [move, setMove] = useState<MoveKey>("interview");
  const [reason, setReason] = useState<string | null>(null);
  const starter = (m: MoveKey) => ({ subject: reply?.failed?.subject ?? reply?.starters.subject ?? "", body: reply?.failed?.body ?? reply?.starters.bodies[m] ?? "" });
  const [edited, setEdited] = useState<{ subject: string; body: string } | null>(null);
  const [changing, setChanging] = useState(false);
  const [mini, setMiniState] = useState(false);
  const [state, draftAction, drafting] = useActionState(draftReplyAction, {});
  useEffect(() => {
    try {
      setMiniState(localStorage.getItem(MINI_KEY) === "1");
    } catch {
      /* the default: open */
    }
  }, []);
  const setMini = (on: boolean) => {
    setMiniState(on);
    try {
      localStorage.setItem(MINI_KEY, on ? "1" : "0");
    } catch {
      /* it lasts for this visit */
    }
  };
  const words = edited ?? starter(move);
  const canWrite = !!reply && reply.enabled && !!reply.to;
  const stored = reply?.draft && !changing ? reply.draft : null;
  const pick = (m: MoveKey) => {
    setMove(m);
    if (m !== "decline") setReason(null);
    setEdited(null);
  };

  // I, T, D pick; ⌘↵ reviews the draft. Never while typing, as the prototype.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canWrite && !stored) {
        e.preventDefault();
        (document.getElementById("triage-draft") as HTMLFormElement | null)?.requestSubmit();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
      const m = offered.find((x) => x.hint.toLowerCase() === e.key.toLowerCase());
      if (m) {
        e.preventDefault();
        pick(m.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const routeLabel = move === "decline" ? "Decline" : move === "interview" ? "Move" : null;
  const summary = move === "decline" ? `Decline${reason ? `: ${routing?.reasons.find((r) => r.reasonId === reason)?.name ?? ""}` : ""}` : move === "testbench" ? "Testbench" : `Interview${team ? ` with ${team}` : ""}`;

  return (
    <div data-tour="route" className="@container relative shrink-0 border-t border-line bg-panel px-4 pt-3 pb-3.5 shadow-[0_-16px_32px_-24px_rgba(0,0,0,0.35)]">
      {reply?.sent && <p className="mb-2 truncate text-xs text-mute">Last sent {reply.sent.when} by {reply.sent.by}: {reply.sent.subject}</p>}
      {mini && (
        <button type="button" onClick={() => setMini(false)} aria-expanded={false} title="Show the reply" className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-line-strong bg-hover px-3.5 text-left transition-colors hover:border-mute">
          <span className="min-w-0 flex-1 truncate text-ink">
            {summary}
            <span className="ml-2 text-mute">{stored ? "draft ready to send" : edited ? "reply edited" : canWrite ? "reply drafted" : ""}</span>
          </span>
          <ChevronsUp size={15} className="shrink-0 text-mute" />
        </button>
      )}

      <div className={`rounded-xl border border-line-strong bg-hover focus-within:border-mute ${mini ? "hidden" : ""}`}>
        {/* Where it goes sits first and never moves: the team, or the reason for a decline */}
        <div className="flex min-h-11 items-start gap-2 border-b border-line px-3.5 py-1.5">
          <span className="w-12 shrink-0 pt-1.5 text-dim">{move === "decline" ? "Reason" : "Team"}</span>
          {move === "decline" ? (
            routing ? (
              <div className="flex min-w-0 flex-1 flex-wrap gap-1 py-0.5" role="radiogroup" aria-label="Reason">
                {routing.reasons.map((r) => (
                  <button
                    key={r.reasonId}
                    type="button"
                    role="radio"
                    aria-checked={reason === r.reasonId}
                    onClick={() => setReason(r.reasonId)}
                    className={`h-7 rounded-md border px-2.5 transition-colors ${reason === r.reasonId ? "border-ink text-ink" : "border-line-strong text-mute hover:text-ink"}`}
                  >
                    {r.name}
                  </button>
                ))}
                {!routing.reasons.length && <span className="pt-1.5 text-mute">Your company has no rejection reasons yet. Add them in Settings.</span>}
              </div>
            ) : (
              <span className="pt-1.5 text-mute">You can&apos;t move people in this job.</span>
            )
          ) : (
            <span className="flex h-8 min-w-0 flex-1 items-center text-ink" title="The job's team">
              <span className="truncate">{team ?? "The job's team"}</span>
            </span>
          )}
          <button type="button" aria-label="Minimize" title="Minimize" onClick={() => setMini(true)} className="-mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-sel hover:text-ink">
            <ChevronsDown size={15} />
          </button>
        </div>

        {!reply ? (
          <p className="px-3.5 py-3 text-mute">You can&apos;t email this candidate from here.</p>
        ) : !reply.enabled ? (
          <p className="px-3.5 py-3 text-mute">Email isn&apos;t set up on this deployment, so no reply can go out from here.</p>
        ) : !reply.to ? (
          <p className="px-3.5 py-3 text-mute">There&apos;s no email address on file for {name}.</p>
        ) : stored ? (
          <>
            <div className="flex items-center gap-2 border-b border-line px-3.5 py-2">
              <span className="w-12 shrink-0 text-dim">To</span>
              <span className="min-w-0 truncate text-ink">{stored.to}</span>
              {reply.sender && <span className="hidden min-w-0 truncate text-dim @2xl:inline">from {reply.sender.from}</span>}
              <span className="ml-auto shrink-0 text-xs text-s-needs">Draft not sent</span>
              <button type="button" onClick={() => { setChanging(true); setEdited({ subject: stored.subject, body: stored.body }); }} className="shrink-0 rounded text-xs text-mute underline decoration-dim underline-offset-2 hover:text-ink">
                Change
              </button>
            </div>
            <div className="px-3.5 pt-2.5 font-medium text-ink">{stored.subject}</div>
            <div className="scroll-quiet h-[150px] overflow-y-auto px-3.5 pt-1.5 pb-2.5 leading-[1.55] whitespace-pre-wrap text-body">{stored.body}</div>
          </>
        ) : (
          <form id="triage-draft" action={draftAction}>
            <input type="hidden" name="applicationId" value={reply.applicationId} />
            <input type="hidden" name="candidateId" value={reply.candidateId} />
            <div className="flex items-center gap-2 border-b border-line px-3.5 py-2">
              <span className="w-12 shrink-0 text-dim">To</span>
              <span className="min-w-0 truncate text-ink">{name}</span>
              <span className="hidden min-w-0 truncate text-dim @2xl:inline">{reply.to}</span>
              <span className="ml-auto shrink-0 text-xs text-dim">{edited ? "Edited" : "Drafted"}</span>
              {edited && (
                <button type="button" onClick={() => { setEdited(null); setChanging(false); }} className="shrink-0 rounded text-xs text-mute underline decoration-dim underline-offset-2 hover:text-ink">
                  Reset
                </button>
              )}
            </div>
            <input
              name="subject"
              required
              maxLength={reply.subjectMax}
              value={words.subject}
              readOnly={drafting}
              onChange={(e) => setEdited({ subject: e.target.value, body: words.body })}
              aria-label="Subject"
              className="block w-full bg-transparent px-3.5 pt-2.5 font-medium text-ink outline-none"
            />
            {/* A fixed height, so nothing above or below shifts when the note appears */}
            <div className="flex h-[150px] flex-col">
              <textarea
                name="body"
                required
                maxLength={reply.bodyMax}
                value={words.body}
                readOnly={drafting}
                onChange={(e) => setEdited({ subject: words.subject, body: e.target.value })}
                aria-label="Reply"
                className="scroll-quiet block min-h-0 w-full flex-1 resize-none bg-transparent px-3.5 pt-1.5 pb-2.5 leading-[1.55] text-body outline-none"
              />
              {move === "testbench" && (
                <div className="px-3.5 pb-2.5">
                  <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-sel px-2 text-xs text-mute">
                    <FileText size={12} /> Their own Testbench link is added when you review the draft
                  </span>
                </div>
              )}
            </div>
          </form>
        )}
        {state.error && (
          <p role="alert" className="border-t border-line px-3.5 py-2 text-bad">
            {state.error}
          </p>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-well p-0.5" role="radiogroup" aria-label="Next step">
          {offered.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={move === m.key}
              aria-keyshortcuts={m.hint}
              onClick={() => pick(m.key)}
              className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 transition-colors ${move === m.key ? "bg-panel text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-mute hover:text-ink"}`}
            >
              {m.label}
              <span className="hidden @3xl:inline">
                <Kbd>{m.hint}</Kbd>
              </span>
            </button>
          ))}
        </div>

        <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
          {laterHref && (
            <Link href={laterHref} className="flex h-8 items-center rounded-lg px-3 text-ink transition-colors hover:bg-hover">
              Later
            </Link>
          )}
          {routing && routeLabel && (
            <form action={routeApplicantAction} className="contents">
              <input type="hidden" name="applicationId" value={routing.applicationId} />
              {routing.next ? <input type="hidden" name="next" value={routing.next} /> : null}
              <input type="hidden" name="route" value={move} />
              {reason ? <input type="hidden" name="reasonId" value={reason} /> : null}
              <Submit solid={!canWrite} disabled={move === "decline" && !reason} title={move === "decline" ? (reason ? "Decline them now, with this reason" : "Pick a reason first") : "Move them to interviewing now"}>
                {routeLabel}
              </Submit>
            </form>
          )}
          {canWrite && stored ? (
            <form action={sendReplyAction} className="contents">
              <input type="hidden" name="draftId" value={stored.draftId} />
              <input type="hidden" name="applicationId" value={reply!.applicationId} />
              <Submit solid>Send</Submit>
            </form>
          ) : canWrite ? (
            <button type="submit" form="triage-draft" disabled={drafting || !words.body.trim() || !words.subject.trim()} title="Writes a draft and sends nothing: you read it, then Send" className="flex h-8 items-center gap-2 rounded-lg bg-ink px-3.5 font-medium text-well transition-opacity hover:opacity-90 disabled:opacity-30">
              {drafting ? "Writing" : "Review Draft"}{" "}
              <span className="text-well/60">
                <Kbd>{mod}</Kbd>
              </span>
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
