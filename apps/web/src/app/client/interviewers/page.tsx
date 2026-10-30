import Link from "next/link";
import { Page, PageHeader, Section, textLink } from "@/components/page";
import { readInterviewers } from "@/lib/client/interviewers";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { InterviewersView, type InterviewerViewGroup } from "./view";

// Who interviews (design/tats's Interviewers, `#bots~people`), read with the
// signed-in member's own token (lib/client/interviewers.ts): one row per
// member on a hiring team as an interviewer or with interviews, grouped by
// department when their jobs have one. Read-only, and counts only.

export default async function ClientInterviewers() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page>
        <PageHeader title="Interviewers" />
        <Section>
          <p className="m-0 text-[13px] text-muted-foreground">
            You&apos;re an interviewer here. The people you interview are on your{" "}
            <Link href="/client" className={textLink}>
              home page
            </Link>
            .
          </p>
        </Section>
      </Page>
    );
  }

  const { groups, feedback, truncated } = await readInterviewers(db, { actorId, orgId: org.id, accessLevel }, new Date());
  const view: InterviewerViewGroup[] = groups.map((g) => ({
    label: g.label ?? "Interviewers",
    rows: g.interviewers.map((i) => ({
      actorId: i.actorId,
      name: i.name,
      thisWeek: i.load.thisWeek,
      nextWeek: i.load.nextWeek,
      last30: i.load.last30,
      feedback: i.feedback,
      jobs: i.jobs.map((j) => j.title),
    })),
  }));

  return (
    <InterviewersView
      groups={view}
      feedback={feedback}
      note={truncated ? "Counted from the first 5,000 interviews; there are more." : null}
      empty={view.length === 0 ? "Nobody interviews yet. Add interviewers to a job's hiring team, or schedule an interview." : null}
    />
  );
}
