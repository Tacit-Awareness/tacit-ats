import { resolveClient, type ClientGate } from "@/lib/client/session";

// The client area's home: who you are, the jobs you can see, and your team.
// Every row on this page was read with the signed-in user's own token, so it
// is exactly what their access allows and nothing has to be filtered here.

type Refusal = Extract<ClientGate, { status: "forbidden" }>["reason"];

const REFUSALS: Record<Refusal, { title: string; body: string }> = {
  signed_out: { title: "You're signed out", body: "Sign in again to continue." },
  not_invited: {
    title: "You haven't been invited yet",
    body: "Ask an admin at your company to invite this email address, then sign in again.",
  },
  email_unverified: {
    title: "Verify your email first",
    body: "Your email address hasn't been verified. Check your inbox for a verification link, then sign in again.",
  },
  no_org: {
    title: "No company on this sign-in",
    body: "You signed in without a company. Use the invitation link your admin sent you.",
  },
  unknown_org: {
    title: "This company isn't set up yet",
    body: "Your company doesn't have a Tacit workspace yet. Contact your Tacit partner.",
  },
  subject_mismatch: {
    title: "This email is linked to another sign-in",
    body: "Sign in the same way you did the first time, or ask your admin to re-send your invitation.",
  },
  token_rejected: {
    title: "We couldn't open your workspace",
    body: "Something on our side isn't configured for your sign-in. Contact your Tacit partner.",
  },
};

const LEVELS = { limited: "Interviewer", elevated: "Hiring team", admin: "Admin" } as const;

export default async function ClientHome() {
  const gate = await resolveClient();
  if (gate.status !== "ok") {
    const refusal = REFUSALS[gate.reason];
    return (
      <main>
        <h1 className="text-2xl font-medium">{refusal.title}</h1>
        <p className="mt-3 text-[15px] text-muted-foreground">{refusal.body}</p>
      </main>
    );
  }

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
    <main className="space-y-10">
      <section>
        <h1 className="text-2xl font-medium">{org.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user.name} · {LEVELS[accessLevel]}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground">Jobs</h2>
        {roles.data.length === 0 ? (
          <p className="mt-2 text-[15px] text-muted-foreground">
            {accessLevel === "admin" ? "No jobs yet." : "You haven't been added to a job yet."}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {roles.data.map((role) => (
              <li key={role.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-[15px]">{role.title}</span>
                <span className="text-xs text-muted-foreground">{role.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {candidates.data ? (
        <section>
          <h2 className="text-sm font-medium text-muted-foreground">People you&apos;re interviewing</h2>
          {candidates.data.length === 0 ? (
            <p className="mt-2 text-[15px] text-muted-foreground">No interviews scheduled.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {candidates.data.map((c) => (
                <li key={c.person_id} className="px-4 py-3">
                  <span className="text-[15px]">{c.display_name}</span>
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
        <h2 className="text-sm font-medium text-muted-foreground">Team</h2>
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
          {team.data.map((member) => (
            <li key={member.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-[15px]">{member.display_name}</span>
              <span className="text-xs text-muted-foreground">
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
