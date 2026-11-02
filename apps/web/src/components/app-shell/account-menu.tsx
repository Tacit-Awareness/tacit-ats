"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TourButton } from "@/components/app-shell/shell-tour";
import { useWarmth } from "@/components/app-shell/warmth";
import { Kbd } from "@/components/keys";
import { SIGN_OUT_KEYS, menuKey, stepIndex } from "@/lib/keys";
import { themeChoice, themeCookie, type ThemeChoice } from "@/lib/theme";
import { cssPx, cssRect } from "@/lib/ui-scale";
import { cn } from "@/lib/utils";
import { MAX_WARMTH, warmthHint } from "@/lib/warmth";

// design/tats's account menu: your name alone as a quiet button at the bottom
// of the sidebar, opening who you are, Onboarding, Settings, Tutorial, the theme and Sign out. On the
// rail the name has no room, so a person glyph opens the same menu: the theme
// and Sign out stay a click away. Under the theme, the warmth fix for this
// display (Off, 1-4; app-shell/warmth.tsx). The menu is portalled to <body>: the sidebar
// clips, and on a phone its transform would trap a fixed box.

const GLYPHS = {
  person: "M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2M3 13.5c.5-2.5 2.5-3.8 5-3.8s4.5 1.3 5 3.8",
  sliders: "M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6M10 3.5v3M6 9.5v3",
  gear: "M12.61 6.05 L14.22 6.48 L14.22 9.52 L12.61 9.95 L12.63 9.88 L13.47 11.32 L11.32 13.47 L9.88 12.63 L9.95 12.61 L9.52 14.22 L6.48 14.22 L6.05 12.61 L6.12 12.63 L4.68 13.47 L2.53 11.32 L3.37 9.88 L3.39 9.95 L1.78 9.52 L1.78 6.48 L3.39 6.05 L3.37 6.12 L2.53 4.68 L4.68 2.53 L6.12 3.37 L6.05 3.39 L6.48 1.78 L9.52 1.78 L9.95 3.39 L9.88 3.37 L11.32 2.53 L13.47 4.68 L12.63 6.12Z M10.2 8a2.2 2.2 0 1 1-4.4 0a2.2 2.2 0 1 1 4.4 0Z",
  tour: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM6.7 5.6 10.4 8l-3.7 2.4Z",
  signout: "M6.5 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.5M9.5 5.2 12.3 8l-2.8 2.8M12.3 8H6",
  light: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1",
  dark: "M13.5 9.4A5.8 5.8 0 0 1 6.6 2.5a5.8 5.8 0 1 0 6.9 6.9Z",
  system: "M2.5 3.5h11v7.5h-11ZM6 13.5h4M8 11v2.5",
} as const;

function Glyph({ name, className }: { name: keyof typeof GLYPHS; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" className={cn("size-[15px] shrink-0", className)} aria-hidden>
      <path d={GLYPHS[name]} />
    </svg>
  );
}

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  document.cookie = themeCookie(choice);
}

const WARMTH_STEPS = Array.from({ length: MAX_WARMTH + 1 }, (_, k) => k);

const pillCls = "grid h-7 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]";
const pillState = (on: boolean) => (on ? "bg-[color:var(--ink)] text-[color:var(--paper)]" : "text-muted-foreground hover:text-foreground");

const optionCls = "flex h-9 w-full items-center gap-2.5 px-3 text-left text-[13.5px] outline-none hover:bg-[color:var(--hover)] focus:bg-[color:var(--hover)]";

export function AccountMenu({ user, rail, pathname }: { user: { name: string; email: string; level: string }; rail: boolean; pathname: string }) {
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const warmth = useWarmth();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = at !== null;
  const name = user.name || user.email;

  const close = () => setAt(null);
  const show = () => {
    const box = button.current?.getBoundingClientRect();
    if (!box) return;
    const r = cssRect(box);
    setTheme(themeChoice(document.documentElement.dataset.theme));
    setAt({ left: Math.max(8, r.left), bottom: Math.max(8, cssPx(innerHeight) - r.top + 6) });
  };

  // It sits on the button: when the button moves or the page changes, it goes.
  useEffect(close, [rail, pathname]);

  useLayoutEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close();
    };
    // On the document's capture phase, so a page's J or K never reaches the list behind.
    const onKey = (e: KeyboardEvent) => {
      const cmd = menuKey(e, 0);
      if (!e.metaKey && !e.ctrlKey && !e.altKey) e.stopPropagation();
      if (!cmd) return;
      if (cmd.kind === "close") {
        // Tab goes on from the button, not from wherever the menu was.
        button.current?.focus();
        return close();
      }
      if (cmd.kind !== "step") return;
      e.preventDefault();
      const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
      items[stepIndex(items.indexOf(document.activeElement as HTMLElement), items.length, cmd.d)]?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={open ? close : show}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name}`}
        title="Account, theme and sign out"
        className="sb-acct"
      >
        <Glyph name="person" className="sb-acct-glyph" />
        <span className="sb-label">{name}</span>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="sb-chev size-3 shrink-0 text-muted-foreground" aria-hidden>
          <path d="M4 10l4-4 4 4" />
        </svg>
      </button>
      {at
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label="Account"
              style={at}
              className="fixed z-[60] max-h-[calc(100*var(--vh)-16px)] w-[280px] max-w-[calc(100vw-16px)] overflow-y-auto border border-[color:var(--line-strong)] bg-raised text-foreground shadow-[var(--pop-shadow)]"
            >
              <div className="grid gap-1 px-4 pt-4 pb-3">
                <div className="flex min-w-0 items-center gap-2">
                  <b className="truncate text-[14.5px] font-semibold">{name}</b>
                  {user.level ? <span className="shrink-0 rounded-full border border-[color:var(--line)] bg-surface px-2 py-px text-[12px] text-muted-foreground">{user.level}</span> : null}
                </div>
                {user.name ? <span className="truncate text-[13px] text-muted-foreground">{user.email}</span> : null}
              </div>
              <div className="border-t border-[color:var(--line)] p-1">
                <Link href="/client/onboarding/people" role="menuitem" onClick={close} className={optionCls}>
                  <Glyph name="sliders" className="text-muted-foreground" />
                  Onboarding
                </Link>
                <Link href="/client/settings" role="menuitem" onClick={close} className={optionCls}>
                  <Glyph name="gear" className="text-muted-foreground" />
                  Settings
                </Link>
                <TourButton role="menuitem" onClick={close} className={optionCls}>
                  <Glyph name="tour" className="text-muted-foreground" />
                  Tutorial
                </TourButton>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-[color:var(--line)] py-1.5 pr-2 pl-4 text-[13.5px]">
                <span className="inline-flex items-center gap-2.5">
                  <Glyph name="dark" className="text-muted-foreground" />
                  Theme
                </span>
                <div role="group" aria-label="Theme" className="pill-track inline-flex rounded-full bg-[color:var(--soft-strong)] p-[3px]">
                  {THEMES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={theme === t.value}
                      aria-label={t.label}
                      title={t.label}
                      onClick={() => {
                        applyTheme(t.value);
                        setTheme(t.value);
                      }}
                      className={cn(pillCls, "w-[34px]", pillState(theme === t.value))}
                    >
                      <Glyph name={t.value} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-[color:var(--line)] py-1.5 pr-2 pl-4 text-[13.5px]">
                <span className="inline-flex items-center gap-2.5" title={warmthHint(warmth.night)}>
                  <Glyph name="system" className="text-muted-foreground" />
                  Warmth fix
                </span>
                <div role="group" aria-label="Warmth correction for this display" className="pill-track inline-flex rounded-full bg-[color:var(--soft-strong)] p-[3px]">
                  {WARMTH_STEPS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="menuitemradio"
                      aria-checked={warmth.level === k}
                      aria-label={k ? `Cool by ${k} step${k > 1 ? "s" : ""}` : "Off, no correction"}
                      title={k ? `Cool by ${k} step${k > 1 ? "s" : ""}` : "No correction"}
                      onClick={() => warmth.set(k)}
                      className={cn(pillCls, "min-w-[26px] px-[7px] text-[12px] tabular-nums", pillState(warmth.level === k))}
                    >
                      {k ? k : "Off"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-t border-[color:var(--line)] p-1">
                {/* A plain form POST, so it can't be triggered by a GET. */}
                <form action="/client/signout" method="post">
                  <button type="submit" role="menuitem" aria-keyshortcuts="Shift+Meta+Q" className={optionCls}>
                    <Glyph name="signout" className="text-muted-foreground" />
                    <span className="flex-1">Sign out</span>
                    {SIGN_OUT_KEYS.split(" ").map((k) => (
                      <Kbd key={k} decorative>
                        {k}
                      </Kbd>
                    ))}
                  </button>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
