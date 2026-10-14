import Link from "next/link";
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
    <main className="max-w-3xl space-y-6">
      <div>
        <Link href="/client" className="text-sm text-muted-foreground hover:text-foreground">
          ← Home
        </Link>
        <h1 className="mt-3 text-2xl font-medium">Jobs</h1>
      </div>
      {roles.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">
          {accessLevel === "admin" ? "No jobs yet." : "You haven't been added to a job yet."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {roles.map((role) => (
            <li key={role.id}>
              <Link
                href={`/client/jobs/${role.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-[color:var(--soft)]"
              >
                <span>
                  <span className="text-[15px]">{role.title}</span>
                  {role.location ? <span className="ml-2 text-sm text-muted-foreground">{role.location}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {showCounts ? `${role.applications[0]?.count ?? 0} in pipeline · ` : ""}
                  {role.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
