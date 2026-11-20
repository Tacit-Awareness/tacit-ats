"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { PopUp } from "@/components/pop-up";

// The pop-up a candidate opens in from any page (components/pop-up.tsx). Closing
// goes back to where you were; focus returns to the link that opened it.
//
// The page behind is still there, so its people are a list to walk: the arrows
// in the head go to the one before and the one after, in the order the page
// shows them, without closing. They replace this entry in the history, so
// closing still lands on the page, not on the last person looked at.

const PREFIX = "/client/candidates/";
const linkSelector = (id: string) => `a[href^="${PREFIX}${id.replace(/["\\]/g, "\\$&")}"]`;

/** The candidates the page behind links to, once each, in the order it shows them. */
function peopleBehind(): string[] {
  const ids: string[] = [];
  for (const a of document.querySelectorAll<HTMLAnchorElement>(`a[href^="${PREFIX}"]`)) {
    if (a.closest('[role="dialog"]')) continue;
    const id = (a.getAttribute("href") ?? "").slice(PREFIX.length).split(/[/?#]/)[0];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function CandidatePopup({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const router = useRouter();
  const [around, setAround] = useState<{ prev: string | null; next: string | null; at: number; of: number }>({ prev: null, next: null, at: 0, of: 0 });
  useEffect(() => {
    const ids = peopleBehind();
    const i = ids.indexOf(id);
    setAround(i < 0 ? { prev: null, next: null, at: 0, of: 0 } : { prev: ids[i - 1] ?? null, next: ids[i + 1] ?? null, at: i + 1, of: ids.length });
  }, [id]);
  const go = (to: string | null) => to && router.replace(`${PREFIX}${to}`, { scroll: false });
  const step = "flex size-7 items-center justify-center rounded-md text-mute transition-colors hover:bg-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <PopUp
      showing={id}
      title={title}
      subject=""
      home={null}
      pageHref={`${PREFIX}${id}`}
      keysTitle="Candidate"
      closeLabel="Close, back to where you were"
      backTo={(shown) => [linkSelector(shown)]}
      tools={
        around.of > 1 ? (
          <span className="flex items-center gap-0.5">
            <span className="mr-1.5 text-[12.5px] text-dim tabular-nums max-sm:hidden">
              {around.at} of {around.of}
            </span>
            <button type="button" aria-label="Previous person" title="Previous person" disabled={!around.prev} onClick={() => go(around.prev)} className={step}>
              <ChevronUp size={16} />
            </button>
            <button type="button" aria-label="Next person" title="Next person" disabled={!around.next} onClick={() => go(around.next)} className={step}>
              <ChevronDown size={16} />
            </button>
          </span>
        ) : null
      }
    >
      {children}
    </PopUp>
  );
}
