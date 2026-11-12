"use client";
// The sign-in frame from tacit-testbench's staff sign-in (components/portal/auth.tsx, StaffAuthFrame): the sky, the
// brand and an optional switch on top, the stage, the theme moon and legal links underneath. Each screen passes its
// own title and card; nothing here knows which app it is in.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Moon, Sun, TacitMark } from "./icons";
import { AUTH_THEME_ATTRIBUTE, DEFAULT_AUTH_THEME_KEY, type AuthTheme } from "./theme";
import "./auth.css";

function readTheme(): AuthTheme {
  return document.documentElement.getAttribute(AUTH_THEME_ATTRIBUTE) === "dark" ? "dark" : "light";
}

/** The theme as <html> has it, kept current whoever changes it; `toggle` remembers the choice. */
export function useAuthTheme(storageKey: string = DEFAULT_AUTH_THEME_KEY) {
  const [theme, setTheme] = useState<AuthTheme>("light");
  useEffect(() => {
    if (!document.documentElement.hasAttribute(AUTH_THEME_ATTRIBUTE)) {
      let stored: string | null = null;
      try { stored = localStorage.getItem(storageKey); } catch { /* storage blocked: stay light */ }
      document.documentElement.setAttribute(AUTH_THEME_ATTRIBUTE, stored === "dark" ? "dark" : "light");
    }
    setTheme(readTheme());
    const watch = new MutationObserver(() => setTheme(readTheme()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: [AUTH_THEME_ATTRIBUTE] });
    return () => watch.disconnect();
  }, [storageKey]);
  const toggle = useCallback(() => {
    const next: AuthTheme = readTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute(AUTH_THEME_ATTRIBUTE, next);
    try { localStorage.setItem(storageKey, next); } catch { /* not remembered */ }
    setTheme(next);
  }, [storageKey]);
  return { theme, toggle };
}

export type AuthLink = { label: string; href: string };

export type AuthFrameProps = {
  children: ReactNode;
  /** The product beside "Tacit" in the lockup: "Testbench Staff", "ATS". */
  product: string;
  /** Where the lockup links. */
  homeHref?: string;
  /** Replaces the Tacit mark in the lockup. */
  logo?: ReactNode;
  /** The top-right switch, e.g. "Taking an assessment? Candidate sign-in". The prompt hides on phones. */
  switchLink?: AuthLink & { prompt?: string };
  /** The footer's links, at the right. */
  footerLinks?: AuthLink[];
  /** The localStorage key the theme moon remembers its choice under. */
  themeStorageKey?: string;
};

export function AuthFrame({ children, product, homeHref = "/", logo, switchLink, footerLinks = [], themeStorageKey }: AuthFrameProps) {
  const { theme, toggle } = useAuthTheme(themeStorageKey);
  const label = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
  return (
    <div className="tacit-auth">
      <div className="sky" aria-hidden="true" />
      <div className="auth">
        <header className="auth-top">
          <a className="brand" href={homeHref} aria-label={`Tacit ${product}`}>
            {logo ?? <TacitMark />}
            <span className="brand-name"><b>Tacit</b> <span>{product}</span></span>
          </a>
          {switchLink && (
            <span className="auth-switch">
              {switchLink.prompt && <span className="auth-switch-ask">{switchLink.prompt}</span>}
              <a href={switchLink.href}>{switchLink.label}</a>
            </span>
          )}
        </header>
        <main className="auth-stage">{children}</main>
        <footer className="auth-foot">
          <div>
            <button type="button" className="icon-btn moon" aria-label={label} title={label} onClick={toggle}>
              {theme === "light" ? <Moon /> : <Sun />}
            </button>
            <span>© {new Date().getFullYear()} Tacit Awareness</span>
          </div>
          {footerLinks.length > 0 && (
            <nav aria-label="Legal">
              {footerLinks.map((link) => <a key={`${link.label} ${link.href}`} href={link.href}>{link.label}</a>)}
            </nav>
          )}
        </footer>
      </div>
    </div>
  );
}
