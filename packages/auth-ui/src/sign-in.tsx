"use client";
// testbench's staff sign-in (components/login.tsx, Login), with the sign-in call and the destination passed in.
import { useState, type FormEvent } from "react";
import { AuthScreen, Busy, ErrorNotice, Field, assignLocation, errorMessage, useFocusAfterError, type Navigate } from "./parts";

export type Credentials = { email: string; password: string };

export type SignInProps = {
  /** Signs in, rejecting with an Error whose message is shown. It may resolve to a destination that replaces
   * `redirectTo`, e.g. the company picker when the person belongs to more than one company. */
  onSignIn: (credentials: Credentials) => Promise<string | void>;
  /** Where to go once signed in. */
  redirectTo: string;
  navigate?: Navigate;
  title?: string;
  /** Shows "Forgot password?" under the password field. */
  forgotPasswordHref?: string;
  /** A second button that signs in with fixed credentials (testbench's local "Explore the demo"). */
  demo?: { label: string; busyLabel: string; credentials: Credentials };
  passwordMinLength?: number;
  initialEmail?: string;
};

export function SignIn({ onSignIn, redirectTo, navigate = assignLocation, title = "Sign in", forgotPasswordHref, demo, passwordMinLength = 8, initialEmail = "" }: SignInProps) {
  const [email, setEmail] = useState(initialEmail), [password, setPassword] = useState("");
  const [busy, setBusy] = useState<false | "form" | "demo">(false), [error, setError] = useState("");
  const rememberFocus = useFocusAfterError(error);
  async function signIn(event?: FormEvent, useDemo = false) {
    event?.preventDefault(); if (busy) return; rememberFocus(); setBusy(useDemo ? "demo" : "form"); setError("");
    let destination: string | void;
    try { destination = await onSignIn(useDemo && demo ? demo.credentials : { email, password }); }
    catch (error) { setError(errorMessage(error)); setBusy(false); return; }
    // Stays busy while the next page loads.
    navigate(destination || redirectTo);
  }
  return (
    <AuthScreen title={title}>
      <form onSubmit={signIn}>
        <Field label="Work email"><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required disabled={!!busy} /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={passwordMinLength} disabled={!!busy} /></Field>
        {forgotPasswordHref && <a className="auth-forgot" href={forgotPasswordHref}>Forgot password?</a>}
        <ErrorNotice>{error}</ErrorNotice>
        <button type="submit" className="btn primary big block" disabled={!!busy}>{busy === "form" ? <Busy>Signing in</Busy> : "Sign in"}</button>
        {demo && <><div className="auth-or">or</div><button type="button" className="btn big block" disabled={!!busy} onClick={() => signIn(undefined, true)}>{busy === "demo" ? <Busy>{demo.busyLabel}</Busy> : demo.label}</button></>}
      </form>
    </AuthScreen>
  );
}
