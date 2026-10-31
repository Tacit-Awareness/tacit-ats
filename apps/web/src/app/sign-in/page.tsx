import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { clientSignInConfigured } from "@/lib/client/config";
import { safeNext } from "@/lib/sign-in/rules";
import { SignInForm } from "./form";
import "./sign-in.css";

export const metadata: Metadata = { title: "Sign in · Tacit", robots: { index: false } };

// Our own sign-in screen, in place of AuthKit's page, the same as Tacit
// Testbench's: one card framed by the mark. Outside proxy.ts's /client matcher,
// so it holds no session and reads nothing.
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  if (!clientSignInConfigured()) notFound();
  const { next } = await searchParams;
  return (
    <main className="sign-in">
      <header className="sign-in-bar">
        <div className="sign-in-brand">
          <span className="tacit-mark" aria-hidden />
          <span>
            Tacit <span>ATS</span>
          </span>
        </div>
        <p className="sign-in-switch">
          <span>New to Tacit?</span> Ask an admin at your company for an invite
        </p>
      </header>
      <div className="sign-in-stage">
        <div className="sign-in-frame">
          <span className="sign-in-logo" aria-hidden />
          <div className="sign-in-card">
            <SignInForm next={safeNext(next)} />
          </div>
        </div>
      </div>
      <footer className="sign-in-foot">
        <span className="tacit-mark" aria-hidden />© {new Date().getFullYear()} Tacit Awareness
      </footer>
    </main>
  );
}
