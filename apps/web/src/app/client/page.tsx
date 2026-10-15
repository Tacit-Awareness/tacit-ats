import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "./refusal";

// The client area's home: who you are, the jobs you can see, and your team.
// Every row on this page was read with the signed-in user's own token, so it
// is exactly what their access allows and nothing has to be filtered here.

const LEVELS = { limited: "Interviewer", elevated: "Hiring team", admin: "Admin" } as const;

export default async function ClientHome() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { db, org, user, accessLevel } = gate.ctx;
  const [roles, team, candidates] = await Promise.all([
    db.from("roles").select("id, title, status").order("created_at", { ascending: false }),
    db.from("org_members").select("id, display_name, email, access_level").order("display_name"),
    // What a limited interviewer may know about the people they interview.
    accessLevel === "limited" ? db.rpc("my_interview_candidates") : Promise.resolve({ data: null, error: null }),
  ]);
  if (roles.error) throw new Error(roles.error.message);
  if (team.error) throw new Error(team.error.message);
  if (candidates.error) throw new Error(candidates.error.message);

  return (
    <main className="max-w-3xl space-y-11">
      <section>
        <h1 className="text-[34px] leading-[1.12] tracking-[-0.01em]">{org.name}</h1>
        <p className="mt-2 text-[15.5px] text-muted-foreground">
          {user.name} · {LEVELS[accessLevel]}
        </p>
      </section>

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-[21px] leading-[1.3]">Jobs</h2>
          <Link href="/client/jobs" className="inline-link text-[14px]">
            All jobs
          </Link>
        </div>
        {roles.data.length === 0 ? (
          <p className="glass mt-3 px-5 py-4 text-[15px] text-muted-foreground">
            {accessLevel === "admin" ? "No jobs yet." : "You haven't been added to a job yet."}
          </p>
        ) : (
          <ul className="glass mt-3 divide-y divide-border overflow-hidden">
            {roles.data.map((role) => (
              <li key={role.id}>
                <Link
                  href={`/client/jobs/${role.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-[rgb(24_24_27/0.02)]"
                >
                  <span className="text-[15px] font-medium">{role.title}</span>
                  <Badge variant={role.status === "open" ? "accent" : "outline"}>{role.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {candidates.data ? (
        <section>
          <h2 className="text-[21px] leading-[1.3]">People you&apos;re interviewing</h2>
          {candidates.data.length === 0 ? (
            <p className="glass mt-3 px-5 py-4 text-[15px] text-muted-foreground">No interviews scheduled.</p>
          ) : (
            <ul className="glass mt-3 divide-y divide-border overflow-hidden">
              {candidates.data.map((c) => (
                <li key={c.person_id} className="px-5 py-3.5">
                  <span className="text-[15px] font-medium">{c.display_name}</span>
                  {c.current_title || c.current_company ? (
                    <span className="ml-2 text-sm text-muted-foreground">
                      {[c.current_title, c.current_company].filter(Boolean).join(" at ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-[21px] leading-[1.3]">Team</h2>
          <Link href="/client/team" className="inline-link text-[14px]">
            {accessLevel === "admin" ? "Manage team" : "Team"}
          </Link>
        </div>
        <ul className="glass mt-3 divide-y divide-border overflow-hidden">
          {team.data.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <span className="text-[15px] font-medium">{member.display_name}</span>
              <span className="text-[13px] text-muted-foreground">
                {member.access_level && member.access_level in LEVELS
                  ? LEVELS[member.access_level as keyof typeof LEVELS]
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
