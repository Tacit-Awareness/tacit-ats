"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LIVE_START, LIVE_TICK_MS, answered, asked, held, parseStamp, refreshed, shouldAsk, shouldRefresh, type Live, type LiveWhy } from "@/lib/live-refresh";

// The page follows work done elsewhere: lib/live-refresh.ts decides, this
// keeps the clock and the listeners. Rendered by the Pipeline and the Inbox
// once a member is in; it draws nothing. The timer runs only while the tab is
// visible. `router.refresh()` re-reads the server render and keeps everything
// held in the browser (a draft, a menu's state, the Inbox's opening).
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    let live: Live = LIVE_START;
    let alive = true;
    let reading = false;
    let dragging = false;
    let timer: number | null = null;

    const check = async (why: LiveWhy) => {
      const now = Date.now();
      if (!reading && shouldAsk(live, now, why, document.hidden)) {
        reading = true;
        live = asked(live, now);
        let stamp: string | null = null;
        try {
          // `redirect: "error"`: a lapsed session redirects to sign-in, and that is not an answer.
          const res = await fetch("/client/live", { cache: "no-store", redirect: "error" });
          if (res.ok) stamp = parseStamp(await res.json());
        } catch {
          // Offline or signed out: the page stays as drawn, and the next tick asks again.
        } finally {
          reading = false;
        }
        if (!alive) return;
        live = answered(live, stamp);
      }
      if (shouldRefresh(live, document.hidden, held(document, dragging))) {
        live = refreshed(live);
        router.refresh();
      }
    };

    const start = () => {
      if (timer === null && !document.hidden) timer = window.setInterval(() => void check("tick"), LIVE_TICK_MS);
    };
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) return stop();
      start();
      void check("back");
    };
    const onFocus = () => void check("back");
    const onDragStart = () => void (dragging = true);
    const onDragEnd = () => void (dragging = false);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragend", onDragEnd);
    start();
    void check("start");
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragend", onDragEnd);
    };
  }, [router]);
  return null;
}
