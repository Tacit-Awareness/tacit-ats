"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// design/tats's ⌘K menu, for now only its "Go to" half: every page and every
// open job, filtered as you type. Its "Ask Grokbot" commands and the actions
// on an applicant come with the pages and the data behind them.

export type CommandItem = { group: string; label: string; href: string };

/** Case-insensitive substring match on the label, in the order given. */
export function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
}

export function CommandMenu({ open, onClose, items }: { open: boolean; onClose: () => void; items: CommandItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const listId = useId();
  const shown = filterCommands(items, query);

  // Opening remembers where focus was and gives it back on close.
  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setHi(0);
    input.current?.focus();
    return () => back.current?.focus();
  }, [open]);

  if (!open) return null;

  const go = (item: CommandItem | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = shown.length;
      if (n) setHi((h) => (h + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(shown[hi]);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[color:var(--scrim)] px-4 pt-[12vh] pb-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] overflow-hidden rounded-xl border border-[color:var(--line-strong)] bg-raised shadow-[var(--pop-shadow)]"
      >
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={shown[hi] ? `${listId}-${hi}` : undefined}
          aria-label="Go to a page or a job"
          placeholder="Go to a page or a job"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHi(0);
          }}
          onKeyDown={onKey}
          className="h-[50px] w-full bg-transparent px-4 text-[15px] outline-none placeholder:text-faint"
        />
        <div id={listId} role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto border-t border-[color:var(--line)] p-1.5">
          {shown.length === 0 ? <p className="m-0 px-2.5 py-2 text-[13px] text-muted-foreground">Nothing matches.</p> : null}
          {shown.map((item, i) => (
            <div key={item.href}>
              {i === 0 || shown[i - 1]!.group !== item.group ? <div className="px-2.5 pt-2 pb-1 text-[11.5px] text-faint">{item.group}</div> : null}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === hi}
                onMouseMove={() => setHi(i)}
                onClick={() => go(item)}
                className={cn("flex h-9 cursor-default items-center rounded-md px-2.5 text-[13.5px]", i === hi && "bg-[color:var(--soft-strong)]")}
              >
                <span className="truncate">{item.label}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3.5 border-t border-[color:var(--line)] px-3.5 py-2 text-xs text-faint">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
