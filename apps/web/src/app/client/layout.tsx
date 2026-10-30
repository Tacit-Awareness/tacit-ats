import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ShellFrame, type ShellJob } from "@/components/app-shell/shell-frame";
import { LEVELS } from "@/lib/client/levels";
import { resolveClient } from "@/lib/client/session";
import { SIDEBAR_COOKIE, parseSidebar } from "@/lib/sidebar";

export const metadata: Metadata = { title: "Tacit" };
export const dynamic = "force-dynamic";

// The client area's shell: design/tats's sidebar and inset panel. The
// sidebar reads who you are and your org's open jobs with your own token
// (resolveClient() is cached per request, so the page's call reuses it), and
// its width from a cookie so the first paint is already right. A refused
// sign-in gets no sidebar: the page renders its refusal on the bare frame.
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") {
    return <div className="flex min-h-dvh flex-1 flex-col bg-frame px-4 py-8">{children}</div>;
  }

  const { db, org, user, accessLevel } = gate.ctx;
  const [{ data: roles, error }, jar] = await Promise.all([
    db.from("roles").select("id, title").eq("status", "open").order("created_at", { ascending: false }),
    cookies(),
  ]);
  if (error) throw new Error(error.message);
  const jobs: ShellJob[] = roles.map((r) => ({ id: r.id, title: r.title }));

  return (
    <ShellFrame
      org={org.name}
      user={{ name: user.name, email: user.email, level: LEVELS[accessLevel] }}
      jobs={jobs}
      sidebar={parseSidebar(jar.get(SIDEBAR_COOKIE)?.value)}
    >
      {children}
    </ShellFrame>
  );
}
