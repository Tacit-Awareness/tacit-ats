"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { menuKey, stepIndex } from "@/lib/keys";
import "../overlays.css";

// The company switcher, as Testbench's workspace select: for someone who is a
// member of more than one company, the sidebar's company name opens the list
// and picking one works there. The list is my_sign_in_orgs() on their own
// token (app/client/layout.tsx). Picking is the sign-in picker's own POST,
// /client/auth/pick-company: set_active_org, which checks they are a member
// there, then a new token carrying that company. Then a full load of Home, so
// the proxy and the layout read the new cookies and no page of the company
// just left stays on screen. Drawn as the account menu's `.ov-menu`, portalled
// to <body> for the same reasons.

export type ShellCompany = { id: string; name: string };

/** Makes `id` the company the member works in, then loads its Home. Throws a sentence the menu can show. */
export async function switchCompany(id: string): Promise<void> {
  let answer: { to: string } | { error: string };
  try {
    const response = await fetch("/client/auth/pick-company", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: id }),
    });
    if (!response.ok) throw new Error(String(response.status));
    answer = (await response.json()) as typeof answer;
  } catch {
    throw new Error("We couldn't reach tATS. Check your connection and try again.");
  }
  if ("error" in answer) throw new Error(answer.error);
  window.location.assign(answer.to);
}

export function CompanyMenu({
  current,
  companies,
  rail,
  children,
}: {
  /** The company on the token now. */
  current: string;
  /** Every company they belong to, the current one included. */
  companies: ShellCompany[];
  rail: boolean;
  /** The button's face: the logo and the name. */
  children: React.ReactNode;
}) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = at !== null;
  const name = companies.find((c) => c.id === current)?.name ?? "";

  const close = () => setAt(null);
  const show = () => {
    const box = button.current?.getBoundingClientRect();
    if (!box) return;
    setError("");
    setAt({ left: Math.max(8, box.left), top: box.bottom + 6 });
  };
  // It sits on the button: when the button moves, it goes.
  useEffect(close, [rail]);

  useLayoutEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    (menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? items?.[0])?.focus({ preventScroll: true });
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
        button.current?.focus();
        return close();
      }
      if (cmd.kind !== "step") return;
      e.preventDefault();
      const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
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

  async function pick(id: string) {
    if (busy) return;
    if (id === current) return close();
    setBusy(id);
    setError("");
    try {
      // On success the page is on its way out, so the row stays busy until it goes.
      await switchCompany(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
      setBusy(null);
    }
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={open ? close : show}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Company: ${name}. Switch company`}
        title={rail ? name : "Switch company"}
        className="sb-org flex h-[34px] min-w-0 flex-1 items-center gap-[9px] px-2 font-sans text-[15px] font-semibold tracking-[-0.01em] transition-colors hover:bg-[color:var(--hover)]"
      >
        {children}
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="sb-chev ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {at
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label="Switch company"
              style={at}
              className="ov-menu fixed z-[60] max-h-[calc(100vh-80px)] w-[264px] max-w-[calc(100vw-16px)] origin-top-left overflow-y-auto"
            >
              <div className="ov-head">
                <span className="text-[12px] text-faint">Your companies</span>
              </div>
              {companies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={c.id === current}
                  aria-busy={busy === c.id || undefined}
                  disabled={busy !== null && busy !== c.id}
                  onClick={() => void pick(c.id)}
                  className="ov-item"
                >
                  <span aria-hidden className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-[color:var(--hover)] text-[10.5px] font-semibold">
                    {c.name.trim().slice(0, 1).toUpperCase() || "?"}
                  </span>
                  <span className="truncate">{c.name}</span>
                  <span className="ov-end text-[12px] text-faint">
                    {busy === c.id ? (
                      "Switching…"
                    ) : c.id === current ? (
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="size-[14px]" aria-hidden>
                        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                      </svg>
                    ) : null}
                  </span>
                </button>
              ))}
              {error ? (
                <p role="alert" className="px-3 py-2 text-[12px] text-[color:var(--red)]">
                  {error}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
