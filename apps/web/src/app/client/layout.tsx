import type { Metadata } from "next";
import { ShellFrame, type ShellJob } from "@/components/app-shell/shell-frame";
import { LEVELS } from "@/lib/client/levels";
import { resolveClient } from "@/lib/client/session";

export const metadata: Metadata = { title: "Tacit" };
export const dynamic = "force-dynamic";

// The client area's shell: tacit-internal's sidebar and inset panel. The
// sidebar reads who you are and your org's open jobs with your own token
// (resolveClient() is cached per request, so the page's call reuses it). A
// refused sign-in gets no sidebar: the page renders its refusal on the bare
// frame.
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") {
    return <div className="flex min-h-dvh flex-1 flex-col bg-frame px-4 py-8">{children}</div>;
  }

  const { db, org, user, accessLevel } = gate.ctx;
  const showCounts = accessLevel !== "limited";
  const { data: roles, error } = await db
    .from("roles")
    .select("id, title, applications(count)")
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const jobs: ShellJob[] = roles.map((r) => ({
    id: r.id,
    title: r.title,
    active: showCounts ? (r.applications[0]?.count ?? 0) : null,
  }));
  const activeTotal = showCounts ? jobs.reduce((n, j) => n + (j.active ?? 0), 0) : null;

  return (
    <ShellFrame org={org.name} user={{ name: user.name, email: user.email, level: LEVELS[accessLevel] }} jobs={jobs} activeTotal={activeTotal}>
      {children}
    </ShellFrame>
  );
}
