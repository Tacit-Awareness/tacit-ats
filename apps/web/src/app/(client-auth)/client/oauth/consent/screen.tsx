"use client";

// The connector consent screen: @tacit-ats/auth-ui's company picker (when the
// member is in more than one company) and testbench's consent screen, on the
// sign-in route's `consent` op (lib/client/auth-ops.ts's consentAction).
import { useEffect, useRef, useState } from "react";
import { AuthFrame, AuthScreen, Busy, CompanyPicker, ConnectorConsent, ErrorNotice, type Company } from "@tacit-ats/auth-ui";
import type { AuthAnswer, ConsentRead } from "@/lib/client/auth-ops";

const PERMISSION = {
  title: "Work in your company's hiring",
  description:
    "Read and update jobs, candidates, pipelines, interviews and feedback as you could in tATS. It acts as you, with your access, and every call is logged.",
};

async function consent(body: Record<string, unknown>): Promise<string> {
  let answer: AuthAnswer;
  try {
    const response = await fetch("/client/auth/consent", {
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

export function ConsentScreen({ authorizationId, read, companies }: { authorizationId: string | null; read: ConsentRead; companies: Company[] }) {
  const [orgId, setOrgId] = useState<string | null>(companies.length === 1 ? companies[0]!.id : null);
  const frame = (children: React.ReactNode) => <AuthFrame product="ATS" homeHref="/client">{children}</AuthFrame>;

  if (read.kind === "gone" || !authorizationId) {
    return frame(<ConnectorConsent authorizationId={null} onDecide={async () => ({ redirectUrl: "/client" })} permission={PERMISSION} />);
  }
  if (!orgId) {
    // Several companies (or none: the picker says so): the pick goes with the approval.
    return frame(
      <CompanyPicker
        title="Which company should it work in?"
        companies={companies}
        email={read.email}
        onPick={async (id) => { setOrgId(id); return "#"; }}
        redirectTo="#"
        navigate={() => {}}
        onSignOut={() => window.location.assign("/client/sign-in")}
      />,
    );
  }
  if (read.kind === "approved") {
    return frame(<RecordAndContinue authorizationId={authorizationId} orgId={orgId} redirectUrl={read.redirectUrl} />);
  }
  return frame(
    <ConnectorConsent
      authorizationId={authorizationId}
      request={{ user: { email: read.email }, client: { name: read.clientName }, redirectUri: read.redirectUri }}
      onDecide={async ({ approve }) => ({ redirectUrl: await consent({ authorizationId, orgId, approve }) })}
      permission={PERMISSION}
    />,
  );
}

/** Approved before: record the company for this sign-in, then go back to the app. */
function RecordAndContinue({ authorizationId, orgId, redirectUrl }: { authorizationId: string; orgId: string; redirectUrl: string }) {
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    consent({ authorizationId, orgId, approve: true, approved: true })
      .then(() => window.location.assign(redirectUrl))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong. Try again."));
  }, [authorizationId, orgId, redirectUrl]);
  return (
    <AuthScreen title="Connecting">
      {error ? <ErrorNotice>{error}</ErrorNotice> : <p className="auth-lead"><Busy>Taking you back to your AI app</Busy></p>}
    </AuthScreen>
  );
}
