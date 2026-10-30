"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useKeyHelp, useKeys } from "@/components/keys";
import { isReviewed, reviewCount, reviewSaver, reviewTarget, saveReview, type ReviewWrite } from "@/lib/client/interview-review-rules";
import { cn } from "@/lib/utils";

// The reviewed check, design/tats's `.ivr-check`: a round button on each past
// row, E for the one you are on, and the bar's count. It shows at once and saves
// behind you, so E then J never waits; a write that fails puts the check back
// and says so. The list keeps its links and server markup: this only wraps them.

// A fetch leaves the router's cache alone, and Back restores a page from it, so
// a page left after a write would come back with its checks as they were.
// Coming back after a write reads them again.
let wrote = false;

const save = async (write: ReviewWrite) => {
  const ok = await saveReview(write);
  if (ok) wrote = true;
  return ok;
};

type Review = {
  past: ReadonlySet<string>;
  selected: string | null;
  /** Null: the checks could not be read, so the page shows none rather than a wrong one. */
  saved: ReadonlySet<string> | null;
  set: ReadonlyMap<string, boolean>;
  failed: boolean;
  toggle: (id: string) => void;
};

const Context = createContext<Review | null>(null);

function useReview() {
  const value = useContext(Context);
  if (!value) throw new Error("A reviewed check outside ReviewProvider.");
  return value;
}

export function ReviewProvider({ past, saved, selected, children }: { past: string[]; saved: string[] | null; selected: string | null; children: React.ReactNode }) {
  const [set, setSet] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [failed, setFailed] = useState(false);
  const [saver] = useState(() =>
    reviewSaver(save, ({ interviewId }, was) => {
      setFailed(true);
      setSet((s) => {
        const back = new Map(s);
        if (was === null) back.delete(interviewId);
        else back.set(interviewId, was);
        return back;
      });
    }),
  );
  const router = useRouter();
  useEffect(() => {
    if (!wrote) return;
    wrote = false;
    router.refresh();
  }, [router]);
  const pastKey = past.join("\n");
  const savedKey = saved?.join("\n") ?? null;
  const value = useMemo<Review>(() => {
    const was = savedKey === null ? null : new Set(savedKey ? savedKey.split("\n") : []);
    return {
      past: new Set(pastKey ? pastKey.split("\n") : []),
      selected,
      saved: was,
      set,
      failed,
      toggle: (id) => {
        if (!was) return;
        const reviewed = !isReviewed(id, was, set);
        setFailed(false);
        setSet((s) => new Map(s).set(id, reviewed));
        void saver({ interviewId: id, reviewed });
      },
    };
  }, [pastKey, savedKey, selected, set, failed, saver]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The bar's count. Live, so a check that did not save is heard as well as seen. */
export function ReviewCount() {
  const { past, saved, set, failed } = useReview();
  if (!saved) return null;
  const left = [...past].filter((id) => !isReviewed(id, saved, set)).length;
  return <span role="status">{failed ? "Not saved, try again" : reviewCount(left)}</span>;
}

/** E, and its line in the `?` sheet. Render after the list, so the line follows J / K's. */
export function ReviewKey() {
  const { past, saved, selected, toggle } = useReview();
  useKeys(
    {
      e: (event) => {
        // Holding E is one press, not a flicker of writes.
        if (event.repeat) return;
        const row = document.activeElement?.closest<HTMLElement>("[data-review-id]");
        const id = reviewTarget(row?.dataset.reviewId ?? null, selected, past);
        if (id) toggle(id);
      },
    },
    !!saved,
  );
  useKeyHelp("Interviews", saved ? [{ keys: "E", label: "Mark reviewed, or not" }] : []);
  return null;
}

/** One row: the server's link, then the check on a past interview. A button beside the link, never inside it. */
export function ReviewRow({ id, candidate, selected, children }: { id: string; candidate: string; selected: boolean; children: React.ReactNode }) {
  const { past, saved, set, toggle } = useReview();
  const reviewable = !!saved && past.has(id);
  const on = reviewable && isReviewed(id, saved, set);
  return (
    <div
      data-review-id={id}
      data-key-row
      data-reviewed={on ? "" : undefined}
      className={cn("group grid grid-cols-[minmax(0,1fr)_auto] items-center pr-[18px] transition-colors", selected ? "bg-[color:var(--sel)]" : "hover:bg-[color:var(--hover)]")}
    >
      {children}
      {reviewable ? (
        <button
          type="button"
          onClick={(event) => {
            toggle(id);
            // A pointer's click leaves no ring to show focus stayed here, and E goes by focus: it means the row open.
            if (event.detail) event.currentTarget.blur();
          }}
          aria-pressed={on}
          aria-label={`${candidate} reviewed`}
          title={on ? "Mark not reviewed" : "Mark reviewed (E)"}
          className={cn(
            "relative grid size-[26px] flex-none place-items-center rounded-full transition-colors after:absolute after:-inset-[9px]",
            on
              ? "bg-foreground text-[color:var(--paper)]"
              : "text-transparent shadow-[0_0_0_1px_var(--line-strong)] group-hover:text-faint hover:bg-[color:var(--soft)] hover:text-foreground focus-visible:text-faint",
          )}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden>
            <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
