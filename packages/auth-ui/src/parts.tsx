"use client";
// The pieces every screen is built from, as testbench's components/ui.tsx and portal/auth.tsx draw them.
import { useEffect, useRef, type ReactNode } from "react";
import { LoaderCircle, TriangleAlert } from "./icons";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function ErrorNotice({ children }: { children?: ReactNode }) {
  return children ? <div className="notice error" role="alert"><TriangleAlert size={17} /><span>{children}</span></div> : null;
}

/** The busy state inside a button: a spinner and what is happening. */
export function Busy({ children }: { children: ReactNode }) {
  return <><LoaderCircle className="spin" />{children}</>;
}

/** A screen: the big title over one card. Keyed by the caller when the step changes, so the card rises again. */
export function AuthScreen({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <div className="auth-flow"><h1 className="auth-title">{title}</h1><div className="auth-card">{children}</div></div>;
}

/** Disabling a form while it submits drops keyboard focus to the page. A failed attempt puts focus back where it was,
 * so the person can correct and resubmit. Call the returned function just before disabling. */
export function useFocusAfterError(error: string) {
  const last = useRef<HTMLElement | null>(null);
  useEffect(() => { if (error && last.current?.isConnected) last.current.focus(); }, [error]);
  return () => { last.current = document.activeElement as HTMLElement | null; };
}

/** What to show for a rejected callback: an Error's message, a thrown string, or a generic line. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Something went wrong. Try again.";
}

/** Where a screen goes once it is done: the host's router if it passes one, a full page load otherwise. */
export type Navigate = (href: string) => void;
export const assignLocation: Navigate = (href) => window.location.assign(href);
