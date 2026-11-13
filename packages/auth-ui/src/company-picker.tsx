"use client";
// New screen in the sign-in frame: a person who belongs to more than one company picks which one to open. The ATS
// backs `onPick` with set_active_org(id) and a session refresh, so the next token carries that company.
import { useState } from "react";
import { ChevronRight } from "./icons";
import { AuthScreen, Busy, ErrorNotice, assignLocation, errorMessage, type Navigate } from "./parts";

export type Company = { id: string; name: string; slug: string };

export type CompanyPickerProps = {
  companies: Company[];
  /** Makes `id` the active company. It may resolve to a destination that replaces `redirectTo`. */
  onPick: (id: string) => Promise<string | void>;
  redirectTo: string;
  navigate?: Navigate;
  /** The signed-in address, shown above the list. */
  email?: string;
  /** Shows "Not you? Sign out" under the list. */
  onSignOut?: () => void | Promise<void>;
  title?: string;
};

export function CompanyPicker({ companies, onPick, redirectTo, navigate = assignLocation, email, onSignOut, title = "Choose a company" }: CompanyPickerProps) {
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  async function pick(id: string) {
    if (busy) return; setBusy(id); setError("");
    let destination: string | void;
    try { destination = await onPick(id); }
    catch (error) { setError(errorMessage(error)); setBusy(null); return; }
    navigate(destination || redirectTo);
  }
  async function signOut() {
    if (busy || !onSignOut) return; setBusy("sign-out"); setError("");
    try { await onSignOut(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(null); }
  }
  const who = email ? <>Signed in as <strong>{email}</strong>. </> : null;
  return (
    <AuthScreen title={companies.length ? title : "No company yet"}>
      {companies.length
        ? <p className="auth-lead">{who}Choose which company to open.</p>
        : <p className="auth-lead">{who}Your account isn’t part of a company yet. Ask your company’s admin to invite you.</p>}
      {companies.length > 0 && (
        <ul className="auth-orgs">
          {companies.map((company) => (
            <li key={company.id}>
              <button type="button" className="auth-org" disabled={!!busy} aria-busy={busy === company.id || undefined} onClick={() => void pick(company.id)}>
                <span className="auth-org-glyph" aria-hidden="true">{initial(company.name)}</span>
                <span className="auth-org-text"><span className="auth-org-name">{company.name}</span><span className="auth-org-slug">{company.slug}</span></span>
                {busy === company.id ? <Busy>{null}</Busy> : <ChevronRight />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNotice>{error}</ErrorNotice>
      {onSignOut && <p className="auth-note">Not you? <button type="button" disabled={!!busy} onClick={() => void signOut()}>Sign out</button></p>}
    </AuthScreen>
  );
}

function initial(name: string): string {
  return (Array.from(name.trim())[0] ?? "?").toUpperCase();
}
