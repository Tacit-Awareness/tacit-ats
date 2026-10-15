import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";

// Every job the signed-in member can see, read with their own token: an admin
// sees the org's jobs (not confidential ones), the hiring team the jobs they
// have access on, an interviewer the jobs they interview for.

export default async function ClientJobs() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { db, accessLevel } = gate.ctx;
  const showCounts = accessLevel !== "limited";
  const { data: roles, error } = await db
    .from("roles")
    .select("id, title, status, location, applications(count)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (
    <main className="max-w-3xl space-y-7">
      <div>
        <Link href="/client" className="text-[14px] text-muted-foreground transition-colors hover:text-foreground">
          ← Home
        </Link>
        <h1 className="mt-3 text-[34px] leading-[1.12] tracking-[-0.01em]">Jobs</h1>
      </div>
      {roles.length === 0 ? (
        <p className="glass px-5 py-4 text-[15px] text-muted-foreground">
          {accessLevel === "admin" ? "No jobs yet." : "You haven't been added to a job yet."}
        </p>
      ) : (
        <ul className="glass divide-y divide-border overflow-hidden">
          {roles.map((role) => (
            <li key={role.id}>
              <Link
                href={`/client/jobs/${role.id}`}
                className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-[rgb(24_24_27/0.02)]"
              >
                <span>
                  <span className="text-[15px] font-medium">{role.title}</span>
                  {role.location ? <span className="ml-2 text-sm text-muted-foreground">{role.location}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {showCounts ? (
                    <span className="font-mono text-xs text-muted-foreground">{role.applications[0]?.count ?? 0} in pipeline</span>
                  ) : null}
                  <Badge variant={role.status === "open" ? "accent" : "outline"}>{role.status}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
