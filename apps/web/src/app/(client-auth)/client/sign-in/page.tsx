import type { Metadata } from "next";
import { safeClientNext } from "@/lib/client/config";
import { SignInScreen } from "../screens";

export const metadata: Metadata = { title: "Sign in · tATS" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const { next, email } = await searchParams;
  return <SignInScreen next={safeClientNext(next)} email={typeof email === "string" ? email.slice(0, 320) : undefined} />;
}
