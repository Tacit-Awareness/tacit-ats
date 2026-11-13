"use client";

// The ATS's sign-in screens: @tacit-ats/auth-ui's (testbench's staff sign-in,
// to the pixel) on Supabase Auth through ./actions. The screens only render
// and call; every decision is the server's.
import { useRouter } from "next/navigation";
import {
  AuthFrame,
  CompanyPicker,
  ForgotPassword,
  LinkExpired,
  SetPassword,
  SignIn,
  type Company,
} from "@tacit-ats/auth-ui";
import type { ReactNode } from "react";
import type { AuthAnswer } from "@/lib/client/auth-ops";

const SIGN_IN = "/client/sign-in";
const FORGOT = "/client/forgot-password";

/** POSTs to the sign-in route: a destination, or the error the screen shows. */
async function call(op: string, body: Record<string, unknown> = {}): Promise<string> {
  let answer: AuthAnswer;
  try {
    const response = await fetch(`/client/auth/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(String(response.status));
    answer = (await response.json()) as AuthAnswer;
  } catch {
    throw new Error("We couldn't reach tATS. Check your connection and try again.");
  }
  if ("error" in answer) throw new Error(answer.error);
  return answer.to;
}

function Frame({ children }: { children: ReactNode }) {
  return <AuthFrame product="ATS" homeHref="/client">{children}</AuthFrame>;
}

/** A full page load after signing in, so the proxy and the layout read the new cookies. */
const hardNavigate = (href: string) => window.location.assign(href);

export function SignInScreen({ next, email }: { next: string; email?: string }) {
  return (
    <Frame>
      <SignIn
        onSignIn={(credentials) => call("sign-in", { ...credentials, next })}
        redirectTo={next}
        navigate={hardNavigate}
        forgotPasswordHref={FORGOT}
        initialEmail={email}
      />
    </Frame>
  );
}

export function ForgotPasswordScreen() {
  return (
    <Frame>
      <ForgotPassword
        onRequestReset={async (email) => { await call("reset", { email }); }}
        signInHref={SIGN_IN}
      />
    </Frame>
  );
}

export function SetPasswordScreen({ email, joining }: { email?: string; joining?: string }) {
  return (
    <Frame>
      <SetPassword
        email={email}
        title={joining ? "Set your password" : "Choose a new password"}
        submitLabel={joining ? "Set password" : "Save password"}
        lead={joining ? <>You’re joining <strong>{joining}</strong>. Choose a password to finish.</> : undefined}
        onSetPassword={(password) => call("set-password", { password })}
        redirectTo="/client"
        navigate={hardNavigate}
      />
    </Frame>
  );
}

export function LinkExpiredScreen() {
  return (
    <Frame>
      <LinkExpired forgotPasswordHref={FORGOT} signInHref={SIGN_IN} />
    </Frame>
  );
}

export function CompanyPickerScreen({ companies, email }: { companies: Company[]; email?: string }) {
  const router = useRouter();
  return (
    <Frame>
      <CompanyPicker
        companies={companies}
        email={email}
        onPick={(orgId) => call("pick-company", { orgId })}
        onSignOut={async () => { router.push(await call("sign-out")); }}
        redirectTo="/client"
        navigate={hardNavigate}
      />
    </Frame>
  );
}
