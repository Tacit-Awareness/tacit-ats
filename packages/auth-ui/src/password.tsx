"use client";
// New screens in the sign-in frame: ask for a reset link, set a password from an invitation or recovery link, and the
// link that no longer works. The calls are passed in; the ATS backs them with Supabase Auth.
import { useState, type FormEvent, type ReactNode } from "react";
import { AuthScreen, Busy, ErrorNotice, Field, assignLocation, errorMessage, useFocusAfterError, type Navigate } from "./parts";

export type ForgotPasswordProps = {
  /** Sends the reset link. Resolve whether or not the address has an account, so the screen does not tell. */
  onRequestReset: (email: string) => Promise<void>;
  signInHref: string;
  initialEmail?: string;
};

export function ForgotPassword({ onRequestReset, signInHref, initialEmail = "" }: ForgotPasswordProps) {
  const [email, setEmail] = useState(initialEmail), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const rememberFocus = useFocusAfterError(error);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; rememberFocus(); setBusy(true); setError("");
    try { await onRequestReset(email.trim()); setSentTo(email.trim()); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  if (sentTo !== null) return (
    <AuthScreen key="sent" title="Check your email">
      <p className="auth-lead">If <strong>{sentTo}</strong> has an account, we sent it a link to set a new password.</p>
      <p className="auth-detail">Check your spam folder if it hasn’t arrived.</p>
      <p className="auth-note">Wrong address? <button type="button" onClick={() => { setSentTo(null); setError(""); }}>Try again</button></p>
    </AuthScreen>
  );
  return (
    <AuthScreen key="form" title="Reset your password">
      <p className="auth-lead">Enter your work email and we’ll send you a link to set a new password.</p>
      <form onSubmit={submit}>
        <Field label="Work email"><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required disabled={busy} /></Field>
        <ErrorNotice>{error}</ErrorNotice>
        <button type="submit" className="btn primary big block" disabled={busy}>{busy ? <Busy>Sending</Busy> : "Send reset link"}</button>
      </form>
      <p className="auth-note">Remembered it? <a href={signInHref}>Back to sign-in</a></p>
    </AuthScreen>
  );
}

export type SetPasswordProps = {
  /** Saves the password for the session the invitation or recovery link opened. It may resolve to a destination
   * that replaces `redirectTo`. */
  onSetPassword: (password: string) => Promise<string | void>;
  redirectTo: string;
  navigate?: Navigate;
  /** Shown read-only above the new password, so a password manager files it under the right account. */
  email?: string;
  /** "Set your password" for an invitation, "Choose a new password" for a recovery link. */
  title?: string;
  lead?: ReactNode;
  submitLabel?: string;
  minLength?: number;
};

export function SetPassword({ onSetPassword, redirectTo, navigate = assignLocation, email, title = "Set your password", lead, submitLabel = "Set password", minLength = 8 }: SetPasswordProps) {
  const [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const rememberFocus = useFocusAfterError(error);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (password !== confirm) { setError("The passwords don’t match."); return; }
    rememberFocus(); setBusy(true); setError("");
    let destination: string | void;
    try { destination = await onSetPassword(password); }
    catch (error) { setError(errorMessage(error)); setBusy(false); return; }
    navigate(destination || redirectTo);
  }
  return (
    <AuthScreen title={title}>
      {lead && <p className="auth-lead">{lead}</p>}
      <form onSubmit={submit}>
        {email && <Field label="Work email"><input type="email" autoComplete="username" value={email} readOnly /></Field>}
        <Field label="New password" hint={`At least ${minLength} characters`}><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={minLength} maxLength={128} disabled={busy} /></Field>
        <Field label="Confirm password"><input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={minLength} maxLength={128} disabled={busy} /></Field>
        <ErrorNotice>{error}</ErrorNotice>
        <button type="submit" className="btn primary big block" disabled={busy}>{busy ? <Busy>Saving</Busy> : submitLabel}</button>
      </form>
    </AuthScreen>
  );
}

/** An invitation or recovery link that has expired or was already used. */
export function LinkExpired({ forgotPasswordHref, signInHref, title = "Link expired", children }: { forgotPasswordHref: string; signInHref: string; title?: string; children?: ReactNode }) {
  return (
    <AuthScreen title={title}>
      <p className="auth-lead">{children ?? "This link has expired or was already used. Request a new one to set your password."}</p>
      <div className="auth-actions">
        <a className="btn big" href={signInHref}>Sign in</a>
        <a className="btn primary big" href={forgotPasswordHref}>Request a new link</a>
      </div>
    </AuthScreen>
  );
}
