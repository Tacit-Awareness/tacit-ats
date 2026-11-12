"use client";
// testbench's MCP consent page (components/connector-consent.tsx), drawn in the sign-in frame, with its two calls
// passed in. Supabase's OAuth server sends a person here to approve an MCP client (Claude, Cursor…).
import { useState, type FormEvent, type ReactNode } from "react";
import { AuthScreen, Busy, ErrorNotice, Field, assignLocation, errorMessage, type Navigate } from "./parts";
import type { Credentials } from "./sign-in";

export type ConsentRequest = { user: { email: string }; client: { name: string }; redirectUri: string | null };

export type ConnectorConsentProps<R extends ConsentRequest> = {
  /** null when the link arrived without one: the screen says to start again from the AI app. */
  authorizationId: string | null;
  /** The request when the person is already signed in; otherwise the screen signs them in first. */
  request?: R | null;
  /** Signs in for this authorization. Resolves to the request to approve, or to a redirect when the client was
   * already approved. Required unless `request` is given. */
  onSignIn?: (input: Credentials & { authorizationId: string }) => Promise<R | { redirectUrl: string }>;
  /** Approves or denies; resolves to where the AI app waits. */
  onDecide: (input: { authorizationId: string; request: R; approve: boolean }) => Promise<{ redirectUrl: string }>;
  /** What the connector may do, shown before the person allows it. */
  permission: { title: string; description: ReactNode };
  /** The line above the sign-in form. */
  signInLead?: ReactNode;
  navigate?: Navigate;
};

export function ConnectorConsent<R extends ConsentRequest>({ authorizationId, request: signedIn = null, onSignIn, onDecide, permission, signInLead = "Sign in with your Tacit account to let an MCP client work on your behalf.", navigate = assignLocation }: ConnectorConsentProps<R>) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState<false | "sign-in" | "allow" | "deny">(false), [error, setError] = useState("");
  const [request, setRequest] = useState<R | null>(signedIn);
  async function signIn(event: FormEvent) {
    event.preventDefault(); if (busy || !authorizationId || !onSignIn) return; setBusy("sign-in"); setError("");
    try {
      const result = await onSignIn({ authorizationId, email, password });
      if ("redirectUrl" in result) { navigate(result.redirectUrl); return; }
      setPassword(""); setRequest(result); setBusy(false);
    } catch (error) { setError(errorMessage(error)); setBusy(false); }
  }
  async function decide(approve: boolean) {
    if (busy || !request || !authorizationId) return; setBusy(approve ? "allow" : "deny"); setError("");
    try { const result = await onDecide({ authorizationId, request, approve }); navigate(result.redirectUrl); }
    catch (error) { setError(errorMessage(error)); setBusy(false); }
  }
  if (!authorizationId) return (
    <AuthScreen key="missing" title="Connection link incomplete">
      <p className="auth-lead">Start the connection again from your AI app. This page needs the link it opens.</p>
    </AuthScreen>
  );
  if (!request) return (
    <AuthScreen key="sign-in" title="Connect an AI app">
      <p className="auth-lead">{signInLead}</p>
      <form onSubmit={signIn}>
        <Field label="Work email"><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required disabled={!!busy} /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={!!busy} /></Field>
        <ErrorNotice>{error}</ErrorNotice>
        <button type="submit" className="btn primary big block" disabled={!!busy}>{busy ? <Busy>Signing in</Busy> : "Continue"}</button>
      </form>
    </AuthScreen>
  );
  return (
    <AuthScreen key="consent" title={`Allow ${request.client.name}?`}>
      <p className="auth-lead">Signed in as <strong>{request.user.email}</strong>.</p>
      <div className="auth-permission"><strong>{permission.title}</strong><p>{permission.description}</p></div>
      {request.redirectUri && <p className="auth-detail">You will return to <code>{request.redirectUri}</code>.</p>}
      <ErrorNotice>{error}</ErrorNotice>
      <div className="auth-actions">
        <button type="button" className="btn big" disabled={!!busy} onClick={() => void decide(false)}>{busy === "deny" ? <Busy>Denying</Busy> : "Deny"}</button>
        <button type="button" className="btn primary big" disabled={!!busy} onClick={() => void decide(true)}>{busy === "allow" ? <Busy>Allowing</Busy> : "Allow access"}</button>
      </div>
    </AuthScreen>
  );
}
