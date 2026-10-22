import Link from "next/link";
import { Avatar, Empty, Glyph, Page, PageHeader, Row, Rows, Section, Split, StatStrip, textLink, type Stat } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { LEVELS, levelName } from "@/lib/client/levels";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "./refusal";

// The client area's home: who you are, the jobs you can see, and your team.
// Every row on this page was read with the signed-in user's own token, so it
// is exactly what their access allows and nothing has to be filtered here.

export default async function ClientHome() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { db, org, user, accessLevel } = gate.ctx;
  const showCounts = accessLevel !== "limited";
  const [roles, team, candidates] = await Promise.all([
    db.from("roles").select("id, title, status, location, applications(count)").order("created_at", { ascending: false }),
    db.from("org_members").select("id, display_name, email, access_level").order("display_name"),
    // What a limited interviewer may know about the people they interview.
    accessLevel === "limited" ? db.rpc("my_interview_candidates") : Promise.resolve({ data: null, error: null }),
  ]);
  if (roles.error) throw new Error(roles.error.message);
  if (team.error) throw new Error(team.error.message);
  if (candidates.error) throw new Error(candidates.error.message);

  const first = user.name.trim().split(/\s+/)[0];
  const open = roles.data.filter((r) => r.status === "open");
  const inPipeline = (r: (typeof roles.data)[number]) => r.applications[0]?.count ?? 0;
  const stats: Stat[] = [
    { label: "Open jobs", value: open.length, href: "/client/jobs" },
    ...(showCounts ? [{ label: "In pipeline", value: open.reduce((n, r) => n + inPipeline(r), 0), href: "/client/jobs" }] : []),
    ...(candidates.data ? [{ label: "Interviewing", value: candidates.data.length }] : []),
    { label: "Team", value: team.data.length, href: "/client/team" },
  ];

  return (
    <Page>
      <PageHeader
        title={first ? `Hi, ${first}` : "Home"}
        subtitle={`${org.name} · ${LEVELS[accessLevel]}`}
        actions={
          <Link href="/client/jobs" className={buttonVariants()}>
            Open jobs
          </Link>
        }
      />

      <StatStrip stats={stats} />

      <Split
        main={
          <>
            {candidates.data ? (
              <Section title="People you're interviewing" count={candidates.data.length}>
                {candidates.data.length === 0 ? (
                  <Empty>No interviews scheduled.</Empty>
                ) : (
                  <Rows>
                    {candidates.data.map((c) => (
                      <Row
                        key={c.person_id}
                        icon={<Avatar name={c.display_name} />}
                        title={c.display_name}
                        sub={[c.current_title, c.current_company].filter(Boolean).join(" at ") || undefined}
                      />
                    ))}
                  </Rows>
                )}
              </Section>
            ) : null}

            <Section
              title="Jobs"
              count={roles.data.length}
              aside={
                <Link href="/client/jobs" className={textLink}>
                  All jobs →
                </Link>
              }
            >
              {roles.data.length === 0 ? (
                <Empty>{accessLevel === "admin" ? "No jobs yet." : "You haven't been added to a job yet."}</Empty>
              ) : (
                <Rows>
                  {roles.data.map((role) => (
                    <Row
                      key={role.id}
                      href={`/client/jobs/${role.id}`}
                      icon={<Glyph name={role.title} size="md" />}
                      title={role.title}
                      sub={role.location ?? undefined}
                      meta={
                        <>
                          {showCounts ? <span className="font-mono text-faint">{inPipeline(role)} in pipeline</span> : null}
                          <StatusBadge status={role.status} />
                        </>
                      }
                    />
                  ))}
                </Rows>
              )}
            </Section>
          </>
        }
        side={
          <Section
            title="Team"
            count={team.data.length}
            aside={
              <Link href="/client/team" className={textLink}>
                {accessLevel === "admin" ? "Manage →" : "View →"}
              </Link>
            }
          >
            <Rows tight>
              {team.data.map((member) => (
                <Row
                  key={member.id}
                  icon={<Avatar name={member.display_name} />}
                  title={member.display_name}
                  meta={<span className="text-faint">{levelName(member.access_level)}</span>}
                />
              ))}
            </Rows>
          </Section>
        }
      />
    </Page>
  );
}
