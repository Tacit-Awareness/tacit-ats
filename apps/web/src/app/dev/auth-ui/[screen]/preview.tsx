"use client";
// Each screen with stand-in callbacks: nothing here signs anyone in. Sign-in always fails the way testbench's does,
// so the error state can be seen; the other calls succeed after a moment and "navigate" back to the index.
import { useRouter } from "next/navigation";
import {
  AuthFrame,
  CompanyPicker,
  ConnectorConsent,
  ForgotPassword,
  LinkExpired,
  SetPassword,
  SignIn,
  type AuthFrameProps,
  type Company,
} from "@tacit-ats/auth-ui";
import type { Screen } from "../screens";

const INDEX = "/dev/auth-ui";
const pause = (ms = 900) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const reject = async (): Promise<never> => { await pause(); throw new Error("Email or password is incorrect"); };

const ATS_FRAME: Omit<AuthFrameProps, "children"> = { product: "ATS", homeHref: INDEX };
// testbench's StaffAuthFrame, prop for prop, so this screen can be laid over its /login.
const TESTBENCH_FRAME: Omit<AuthFrameProps, "children"> = {
  product: "Testbench Staff",
  homeHref: INDEX,
  switchLink: { prompt: "Taking an assessment?", label: "Candidate sign-in", href: INDEX },
  footerLinks: [{ label: "Documentation", href: INDEX }, { label: "Privacy", href: INDEX }],
};

const COMPANIES: Company[] = [
  { id: "1", name: "Tacit Test Co", slug: "tacit-test-co" },
  { id: "2", name: "Northwind Robotics", slug: "northwind" },
  { id: "3", name: "Acme Aerospace Research and Development Laboratories", slug: "acme-aerospace-research" },
];

const PERMISSION = {
  title: "Work in your company's hiring",
  description: "Read and update jobs, candidates, pipelines, interviews and feedback as you could in the ATS. It acts as you, with your access, and every call is logged.",
};
const CONSENT_REQUEST = { user: { email: "ryan@tacitawareness.com" }, client: { name: "Claude" }, redirectUri: "https://claude.ai/api/mcp/auth_callback" };

export function Preview({ screen, label }: { screen: Screen; label: string }) {
  const router = useRouter();
  const navigate = (href: string) => router.push(href);
  const frame = screen === "sign-in-testbench" ? TESTBENCH_FRAME : ATS_FRAME;
  return <AuthFrame {...frame}><title>{label}</title>{render(screen, navigate)}</AuthFrame>;
}

function render(screen: Screen, navigate: (href: string) => void) {
  switch (screen) {
    case "sign-in":
      return <SignIn onSignIn={reject} redirectTo={INDEX} navigate={navigate} forgotPasswordHref={`${INDEX}/forgot-password`} />;
    case "sign-in-testbench":
      return <SignIn title="Staff sign-in" onSignIn={reject} redirectTo={INDEX} navigate={navigate} demo={{ label: "Explore the demo", busyLabel: "Opening the demo", credentials: { email: "demo@tacit.local", password: "tacit-local-only" } }} />;
    case "forgot-password":
      return <ForgotPassword onRequestReset={() => pause()} signInHref={`${INDEX}/sign-in`} />;
    case "set-password":
      return <SetPassword email="new.member@tacittest.co" lead={<>You’re joining <strong>Tacit Test Co</strong>. Choose a password to finish.</>} onSetPassword={() => pause()} redirectTo={INDEX} navigate={navigate} />;
    case "reset-password":
      return <SetPassword title="Choose a new password" email="ryan@tacitawareness.com" submitLabel="Save password" onSetPassword={() => pause()} redirectTo={INDEX} navigate={navigate} />;
    case "link-expired":
      return <LinkExpired forgotPasswordHref={`${INDEX}/forgot-password`} signInHref={`${INDEX}/sign-in`} />;
    case "company-picker":
      return <CompanyPicker companies={COMPANIES} email="ryan@tacitawareness.com" onPick={() => pause(1400)} onSignOut={() => navigate(`${INDEX}/sign-in`)} redirectTo={INDEX} navigate={navigate} />;
    case "company-picker-empty":
      return <CompanyPicker companies={[]} email="someone@example.com" onPick={() => pause()} onSignOut={() => navigate(`${INDEX}/sign-in`)} redirectTo={INDEX} navigate={navigate} />;
    case "consent-sign-in":
      return <ConnectorConsent authorizationId="preview" onSignIn={async () => { await pause(); return CONSENT_REQUEST; }} onDecide={async () => { await pause(); return { redirectUrl: INDEX }; }} permission={PERMISSION} navigate={navigate} />;
    case "consent":
      return <ConnectorConsent authorizationId="preview" request={CONSENT_REQUEST} onDecide={async () => { await pause(); return { redirectUrl: INDEX }; }} permission={PERMISSION} navigate={navigate} />;
    case "consent-missing":
      return <ConnectorConsent authorizationId={null} onDecide={async () => ({ redirectUrl: INDEX })} permission={PERMISSION} navigate={navigate} />;
  }
}
