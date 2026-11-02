"use client";

import Link from "next/link";
import * as React from "react";
import { buttonVariants } from "@/components/ui/button";
import { BANNER_ICONS, DISMISSED_KEY, addDismissed, bannerRole, orderActions, parseDismissed, type BannerActionVariant, type BannerStatus } from "@/lib/banner-rules";
import { browserArea, createMemory } from "@/lib/browser-memory";
import { cn } from "@/lib/utils";
import "./banner.css";

// design/tats's Banner (`banner()` in its app.js, after Fluid Functionalism's):
// a status message with an icon, a title, a line under it, up to three actions
// and a ✕. Low contrast is the card's own fill with the icon in the status
// colour, high a light wash of it. Inline sits in the page; fixed is a
// full-bleed bar stuck to the top of its scroller. Compact is one line, the
// actions on the right. The rules are lib/banner-rules.ts.
//
// Dismissing folds the height to nothing, then remembers the `id` in this
// browser (lib/browser-memory.ts: blocked storage keeps it until a reload).
// Without an `id` it is gone until the page renders again. A dismissible banner
// with an `id` is not on the server's page, which cannot know what this browser
// dismissed: it arrives on hydration, with the entrance it has anyway.

export type BannerAction = {
  label: string;
  variant?: BannerActionVariant;
  /** A link; `external` opens it in a new tab. */
  href?: string;
  external?: boolean;
  onClick?: () => void;
  /** The prototype's "Ignore": the action dismisses the banner. */
  dismiss?: boolean;
};

export type BannerProps = {
  /** Remembers a dismissal. Make it change when what the banner says does, so news shows again. */
  id?: string;
  status?: BannerStatus;
  contrast?: "low" | "high";
  variant?: "inline" | "fixed";
  size?: "default" | "compact";
  title: React.ReactNode;
  desc?: React.ReactNode;
  actions?: BannerAction[];
  dismissible?: boolean;
  /** A path in the 16px box, in place of the status's own glyph. */
  icon?: string;
  className?: string;
};

const dismissed = createMemory({ key: DISMISSED_KEY, area: browserArea, parse: parseDismissed });
const noSubscribe = () => () => {};
/** The collapse's length, in step with banner.css. */
const FOLD_MS = 240;

const actionClass = (v: BannerActionVariant | undefined) =>
  cn(buttonVariants({ size: "sm", variant: v === "primary" ? "default" : v === "ghost" ? "ghost" : "outline" }), "bn-a", v === "ghost" && "ghost");

export function Banner({ id, status = "default", contrast = "low", variant = "inline", size = "default", title, desc, actions = [], dismissible = false, icon, className }: BannerProps) {
  const remembers = dismissible && !!id;
  // Null on the server and until hydration: whether this browser dismissed it is not known yet.
  const list = React.useSyncExternalStore(
    remembers ? dismissed.subscribe : noSubscribe,
    () => (remembers ? dismissed.get().value : null),
    () => null,
  );
  const [out, setOut] = React.useState(false);
  const [gone, setGone] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (!remembers) return;
    // Dismissed in another tab: this one follows.
    const onStorage = (e: StorageEvent) => {
      if (e.key === DISMISSED_KEY) dismissed.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [remembers]);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (gone || (remembers && (list === null || list.includes(id!)))) return null;

  const dismiss = () => {
    if (out) return;
    setOut(true);
    const calm = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    timer.current = setTimeout(
      () => {
        if (id) dismissed.update((l) => addDismissed(l, id));
        setGone(true);
      },
      calm ? 0 : FOLD_MS,
    );
  };

  const acts = orderActions(actions);
  return (
    <div
      className={cn("bn", `s-${status}`, contrast === "high" && "high", variant === "fixed" && "fixed", size === "compact" && "compact", out && "out", className)}
      role={bannerRole(status)}
      data-banner={id}
    >
      <div className="bn-in">
        <div className="bn-box">
          <span className="bn-ico">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d={icon ?? BANNER_ICONS[status]} />
            </svg>
          </span>
          <div className="bn-txt">
            <b className="bn-t">{title}</b>
            {desc ? <span className="bn-d">{desc}</span> : null}
          </div>
          {dismissible ? (
            <button type="button" className="bn-x" onClick={dismiss} aria-label="Dismiss" title="Dismiss">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
          ) : null}
          {acts.length ? (
            <div className="bn-acts">
              {acts.map((a) =>
                a.href ? (
                  a.external ? (
                    <a key={a.label} className={actionClass(a.variant)} href={a.href} target="_blank" rel="noopener noreferrer">
                      {a.label}
                      <svg className="bn-ext" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M5.5 10.5l5-5M6.5 5.5h4v4" />
                      </svg>
                    </a>
                  ) : (
                    <Link key={a.label} className={actionClass(a.variant)} href={a.href}>
                      {a.label}
                    </Link>
                  )
                ) : (
                  <button
                    key={a.label}
                    type="button"
                    className={actionClass(a.variant)}
                    onClick={() => {
                      a.onClick?.();
                      if (a.dismiss) dismiss();
                    }}
                  >
                    {a.label}
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
