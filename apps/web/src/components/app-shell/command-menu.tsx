"use client";

import { useRouter } from "next/navigation";
import { mayLeave } from "@/lib/leave-guard";
import { useEffect, useId, useRef, useState } from "react";
import { useCurrentCommandContext, type CommandContext } from "@/components/app-shell/command-context";
import { Kbd } from "@/components/keys";
import { cn } from "@/lib/utils";
import "../overlays.css";

// design/tats's ⌘K menu: every page and every open job, filtered as you type; the
// candidates the member's own token can find (`/client/search`, debounced, so an
// interviewer finds only the people they interview), and what can be done about
// the candidate that's open (command-context.ts). An action only opens a control
// the page already has, so nothing here writes. Candidate text is React text. The
// prototype's "Ask Grokbot" commands have nothing behind them here. Drawn as
// Testbench's `.dialog.cmdk` (overlays.css): the keys are the search row's hover
// title and the kbd on the item you are on, not a row of their own.

export type CommandItem = { group: string; label: string; href?: string; sub?: string | null; hint?: string; run?: () => void };

export type CandidateHit = { candidateId: string; name: string; line: string | null };

export const SEARCH_DEBOUNCE_MS = 200;
/** Testbench's `.cmdk` keys: a sunken cap with a hairline, quieter than a button's. */
const SUNKEN = "h-[22px] min-w-[22px] rounded-[5px] bg-[color:var(--soft)] px-1.5 text-faint opacity-100 shadow-[inset_0_0_0_1px_var(--line-strong)]";
const SEARCH_MIN = 2;

/** Case-insensitive substring match on the label, in the order given. */
export function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
}

export const hitItem = (hit: CandidateHit): CommandItem => ({ group: "Candidates", label: hit.name, sub: hit.line, href: `/client/candidates/${hit.candidateId}` });

export const contextItems = (ctx: CommandContext | null): CommandItem[] => (ctx ? ctx.actions.map((a) => ({ group: "This candidate", label: a.label, hint: a.hint, run: a.run })) : []);

/** What's listed: the open candidate's actions, then the pages, then who the search found. */
export const menuItems = (ctx: CommandContext | null, items: CommandItem[], hits: CandidateHit[], query: string): CommandItem[] => [
  ...filterCommands(contextItems(ctx), query),
  ...filterCommands(items, query),
  ...hits.map(hitItem),
];

/** Who the search answers for this query, debounced: a new key cancels what's still asking. */
function useCandidateSearch(query: string) {
  const [found, setFound] = useState<{ q: string; hits: CandidateHit[]; failed: boolean } | null>(null);
  const q = query.trim();
  const asking = Array.from(q).length >= SEARCH_MIN;

  useEffect(() => {
    if (!asking) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/client/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const { hits } = (await res.json()) as { hits: CandidateHit[] };
        setFound({ q, hits, failed: false });
      } catch {
        if (!controller.signal.aborted) setFound({ q, hits: [], failed: true });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, asking]);

  const answered = asking && found?.q === q ? found : null;
  return { hits: answered?.hits ?? [], searching: asking && !answered, failed: !!answered?.failed };
}

export function CommandMenu({ open, onClose, items }: { open: boolean; onClose: () => void; items: CommandItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const listId = useId();
  const ctx = useCurrentCommandContext();
  const { hits, searching, failed } = useCandidateSearch(open ? query : "");
  const shown = menuItems(ctx, items, hits, query);
  const at = Math.min(hi, Math.max(0, shown.length - 1));

  // Opening remembers where focus was and gives it back on close.
  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setHi(0);
    input.current?.focus();
    return () => back.current?.focus();
  }, [open]);

  // The row you are on stays in view as the arrows move it through a long list.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${at}`)?.scrollIntoView({ block: "nearest" });
  }, [open, at, listId]);

  if (!open) return null;

  const go = (item: CommandItem | undefined) => {
    if (!item) return;
    onClose();
    if (item.href && mayLeave()) router.push(item.href);
    // After focus has gone back: an action moves it on.
    else if (item.run) requestAnimationFrame(item.run);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = shown.length;
      if (n) setHi((at + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(shown[at]);
    }
  };

  return (
    <div className="pop-scrim ov-scrim fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[16vh] pb-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        onMouseDown={(e) => e.stopPropagation()}
        className="pop-dialog ov-dialog flex max-h-[min(560px,80vh)] w-full max-w-[640px] flex-col overflow-hidden"
      >
        <div className="ov-cmdk-input" title="↑ ↓ to move, ↵ to open, esc to close">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden>
            <path d="M7 7m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M10.5 10.5l3 3" />
          </svg>
          {ctx ? <span className="inline-flex h-6 max-w-[40%] flex-none items-center truncate rounded-[6px] bg-[color:var(--soft-strong)] px-2 text-[12px] font-medium text-muted-foreground">{ctx.name}</span> : null}
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown[at] ? `${listId}-${at}` : undefined}
            aria-label="Search for a page, a job or a candidate"
            placeholder="Search for a page, a job or a candidate"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHi(0);
            }}
            onKeyDown={onKey}
          />
          <Kbd decorative className={cn(SUNKEN, "flex-none max-sm:hidden")}>
            esc
          </Kbd>
        </div>
        <div id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-2.5">
          {shown.length === 0 && !searching && !failed ? <p className="m-0 py-10 text-center font-sans text-[14px] text-faint">Nothing matches.</p> : null}
          {shown.map((item, i) => (
            <div key={`${item.group}:${item.href ?? item.label}`}>
              {i === 0 || shown[i - 1]!.group !== item.group ? <div className="ov-cmdk-group">{item.group}</div> : null}
              <div id={`${listId}-${i}`} role="option" aria-selected={i === at} onMouseMove={() => setHi(i)} onClick={() => go(item)} className="ov-cmdk-item">
                <span className="ov-cmdk-label flex-none max-sm:flex-initial">{item.label}</span>
                {item.sub ? <span className="ov-cmdk-sub">{item.sub}</span> : null}
                <span className="ml-auto flex flex-none items-center gap-1.5">
                  {item.hint ? <Kbd className={SUNKEN}>{item.hint}</Kbd> : null}
                  {i === at ? (
                    <Kbd decorative className={SUNKEN}>
                      ↵
                    </Kbd>
                  ) : null}
                </span>
              </div>
            </div>
          ))}
          <p role="status" className={cn("m-0 text-[12.5px] text-faint", (searching || failed) && "px-2.5 py-2")}>
            {searching ? "Searching candidates…" : failed ? "Candidate search isn't working right now." : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
