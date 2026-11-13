import { cookies } from "next/headers";
import Link from "next/link";
import { Empty, Page, PageBar, Row, Rows, Section, Split, StatStrip, textLink, type Stat } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { readHome } from "@/lib/client/home";
import { parseHomeSub } from "@/lib/client/home-tabs";
import { WIDGETS_COOKIE, parseWidgets } from "@/lib/client/home-widgets";
import { parsePeriod } from "@/lib/client/home-metrics";
import { LEVELS, levelName } from "@/lib/client/levels";
import { resolveClient, type ClientContext } from "@/lib/client/session";
import { overviewProps } from "./home-props";
import { ApplicantsContent } from "./applicants/tickets";
import { HomeTab, HomeView } from "./home-view";
import { InterviewsContent } from "./interviews/interviews-page";
import { ReferralsContent } from "./referrals/referrals-page";
import { Refusal } from "./refusal";

// The client area's home. For admins and the hiring team, design/tats's
// Recruiting Overview: where are candidates getting stuck? (lib/client/home.ts
// reads, lib/client/home-metrics.ts counts, home-props.ts words it,
// home-view.tsx draws, home-board.tsx arranges), with the period (?days=7|30|90), the department
// (?department=, none for an org without departments) and the job (?job=)
// in the URL. `?sub=` draws a tab's page under Home's bar (lib/client/home-tabs.ts). An admin sets each card's target from the card; the hiring team
// sees them. An interviewer keeps the page they had: the people they
// interview, the jobs, the team, in the same dress as the Overview (the title
// row on the surface, the numbers in one stats card, white cards under it). Every number is read with the member's own
// token, so it counts only what their access allows and nothing is filtered
// here.

export default async function ClientHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const ctx = gate.ctx;
  if (ctx.accessLevel === "limited") return <InterviewerHome ctx={ctx} />;

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const sub = parseHomeSub(one(sp.sub));
  if (sub) {
    return (
      <HomeTab sub={sub}>
        {sub === "tickets" ? <ApplicantsContent sp={sp} home /> : sub === "interviews" ? <InterviewsContent sp={sp} home /> : <ReferralsContent sp={sp} home />}
      </HomeTab>
    );
  }
  const days = parsePeriod(one(sp.days));
  const now = new Date();
  const [read, jar] = await Promise.all([
    readHome(
      ctx.db,
      { actorId: ctx.actorId, orgId: ctx.org.id, accessLevel: ctx.accessLevel },
      { days, jobId: one(sp.job) || null, departmentId: one(sp.department) || null },
      now,
    ),
    cookies(),
  ]);
  // No layout saved yet is the default (lib/client/home-widgets.ts), the one Reset goes back to.
  return <HomeView {...overviewProps(read, days, now.getTime(), ctx.accessLevel === "admin")} layout={parseWidgets(jar.get(WIDGETS_COOKIE)?.value)} />;
}

/** An interviewer's home: the people they interview, the jobs they can see, the team. */
async function InterviewerHome({ ctx }: { ctx: ClientContext }) {
  const { db, org, user, accessLevel } = ctx;
  const [roles, team, candidates] = await Promise.all([
    db.from("roles").select("id, title, status, location").order("created_at", { ascending: false }),
    db.from("org_members").select("id, display_name, email, access_level").order("display_name"),
    // What a limited interviewer may know about the people they interview.
    db.rpc("my_interview_candidates"),
  ]);
  if (roles.error) throw new Error(roles.error.message);
  if (team.error) throw new Error(team.error.message);
  if (candidates.error) throw new Error(candidates.error.message);

  const first = user.name.trim().split(/\s+/)[0];
  const open = roles.data.filter((r) => r.status === "open");
  const stats: Stat[] = [
    { label: "Open jobs", value: open.length, href: "/client/jobs" },
    { label: "Interviewing", value: candidates.data.length },
    { label: "Team", value: team.data.length },
  ];

  return (
    <Page
      bar={
        <PageBar
          title={
            <span title={`${org.name}, ${LEVELS[accessLevel]}`}>
              {first ? `Hi, ${first}` : "Home"}
              <span className="sr-only">
                , {org.name}, {LEVELS[accessLevel]}
              </span>
            </span>
          }
        >
          <Link href="/client/jobs" className={buttonVariants()}>
            Open jobs
          </Link>
        </PageBar>
      }
    >
      <StatStrip stats={stats} />

      <Split
        main={
          <>
            <Section title="People you're interviewing" count={candidates.data.length}>
              {candidates.data.length === 0 ? (
                <Empty>No interviews scheduled.</Empty>
              ) : (
                <Rows>
                  {candidates.data.map((c) => (
                    <Row
                      key={c.person_id}
                      title={c.display_name}
                      sub={[c.current_title, c.current_company].filter(Boolean).join(" at ") || undefined}
                    />
                  ))}
                </Rows>
              )}
            </Section>

            <Section
              title="Jobs"
              count={roles.data.length}
              aside={
                <Link href="/client/jobs" className={textLink}>
                  All jobs
                </Link>
              }
            >
              {roles.data.length === 0 ? (
                <Empty>You haven&apos;t been added to a job yet.</Empty>
              ) : (
                <Rows>
                  {roles.data.map((role) => (
                    <Row
                      key={role.id}
                      href={`/client/jobs/${role.id}`}
                      title={role.title}
                      sub={role.location ?? undefined}
                      meta={<StatusBadge status={role.status} />}
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
          >
            <Rows tight>
              {team.data.map((member) => (
                <Row
                  key={member.id}
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
