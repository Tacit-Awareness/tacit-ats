import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ShellFrame, type ShellJob, type ShellTeam } from "@/components/app-shell/shell-frame";
import { WarmthFilter } from "@/components/app-shell/warmth";
import { BrandStyle } from "@/components/brand-style";
import { departmentOptions } from "@/lib/client/department-tree";
import { LEVELS } from "@/lib/client/levels";
import { resolveClient } from "@/lib/client/session";
import { SIDEBAR_COOKIE, parseSidebar } from "@/lib/sidebar";

// The tab reads "<Company> · tATS"; a refused sign-in has no company to name.
export async function generateMetadata(): Promise<Metadata> {
  const gate = await resolveClient();
  return { title: gate.status === "ok" ? `${gate.ctx.org.name} · tATS` : "tATS" };
}
export const dynamic = "force-dynamic";

// The client area's shell: Tacit Tickets' sidebar and inset panel. The
// sidebar reads who you are, your org's open jobs and its departments (the
// Teams) with your own token
// (resolveClient() is cached per request, so the page's call reuses it), and
// its width from a cookie so the first paint is already right. A refused
// sign-in gets no sidebar: the page renders its refusal on the bare frame.
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") {
    return <div className="flex min-h-dvh flex-1 flex-col bg-frame px-4 py-8">{children}</div>;
  }

  const { db, org, user, accessLevel, actorId } = gate.ctx;
  const [{ data: roles, error }, jar, mine, depts] = await Promise.all([
    db.from("roles").select("id, title").eq("status", "open").order("created_at", { ascending: false }),
    cookies(),
    // Every company this person belongs to, on their own token, for the sidebar's switcher.
    db.rpc("my_sign_in_orgs" as never),
    // The sidebar's Teams: the org's departments, which an interviewer cannot read.
    db.from("departments").select("id, name, parent_id, archived_at").order("name").limit(500),
  ]);
  if (error) throw new Error(error.message);
  const jobs: ShellJob[] = roles.map((r) => ({ id: r.id, title: r.title }));
  // A nicety: a failed read leaves the name as it was, with no switcher.
  // A nicety too: a failed read leaves the sidebar without Teams.
  const teams: ShellTeam[] = depts.error
    ? []
    : departmentOptions((depts.data ?? []).map((d) => ({ id: d.id, name: d.name, parentId: d.parent_id, archived: d.archived_at !== null }))).map(({ id, name, depth }) => ({ id, name, depth }));
  const companies = mine.error ? [] : ((mine.data ?? []) as { id: string; name: string }[]).map(({ id, name }) => ({ id, name }));

  return (
    <>
      <BrandStyle accent={org.brandAccent} />
      {/* The account menu's warmth fix, per display, from this browser only. */}
      <WarmthFilter />
      <ShellFrame
        actorId={actorId}
        org={org.name}
        orgLogoUrl={org.brandLogoUrl}
        orgId={org.id}
        companies={companies}
        user={{ name: user.name, email: user.email, level: LEVELS[accessLevel] }}
        jobs={jobs}
        teams={teams}
        sidebar={parseSidebar(jar.get(SIDEBAR_COOKIE)?.value)}
      >
        {children}
      </ShellFrame>
    </>
  );
}
