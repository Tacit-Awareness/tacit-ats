import Link from "next/link";
import { notFound } from "next/navigation";
import { ACTIVE_STAGES, APPLICATION_STAGES, getRolePipeline } from "@tacit/core";
import { PipelineBoard } from "@/components/pipeline-board";
import { Empty, Page, PageHeader, Pill, Section, textLink } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../refusal";
import { CLIENT_PIPELINE_ACTIONS } from "./board-actions";

// One job and its pipeline, read with the signed-in member's own token. What
// the board holds is what the policies let them read (every candidate for an
// admin or the hiring team, only their own adds for an external recruiter,
// none for an interviewer), and the edit controls appear only where they may
// write (can_edit_pipeline on this job). Nothing is filtered here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOSED_STAGES = APPLICATION_STAGES.filter((s) => !ACTIVE_STAGES.includes(s));

export default async function ClientJob({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { db, accessLevel } = gate.ctx;

  const [pipeline, canEdit, team, role] = await Promise.all([
    getRolePipeline(db, id),
    db.rpc("can_on_role", { p_role: id, perm: "can_edit_pipeline" }),
    db.from("org_members").select("id, display_name").order("display_name"),
    db.from("roles").select("location, seniority").eq("id", id).maybeSingle(),
  ]);
  if (!pipeline) notFound();
  for (const r of [canEdit, team, role]) if (r.error) throw new Error(r.error.message);

  const editable = canEdit.data === true;
  const cards = pipeline.cards.map((c) => ({ ...c, roleId: pipeline.roleId, roleTitle: pipeline.roleTitle }));
  const owners = (team.data ?? []).map((m) => ({ actorId: m.id!, name: m.display_name ?? "" }));
  const details = [role.data?.seniority, role.data?.location].filter(Boolean).join(" · ");

  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/client/jobs", label: "Job Postings" }]}
        title={pipeline.roleTitle}
        badge={<StatusBadge status={pipeline.roleStatus} />}
        subtitle={details || undefined}
        actions={
          <Link href={`/client/jobs/${pipeline.roleId}/post`} className={textLink}>
            Job post
          </Link>
        }
      />

      {accessLevel === "limited" ? (
        <Section>
          <p className="m-0 text-[13px] text-muted-foreground">
            You&apos;re an interviewer on this job. The people you interview are on your{" "}
            <Link href="/client" className={textLink}>
              home page
            </Link>
            .
          </p>
        </Section>
      ) : (
        <Section
          title="Pipeline"
          count={cards.length}
          aside={pipeline.stalledCount > 0 && <Pill tone="red">{pipeline.stalledCount} need attention</Pill>}
        >
          {cards.length === 0 ? (
            <Empty>Nobody is in this job&apos;s pipeline yet.</Empty>
          ) : (
            <PipelineBoard
              cards={cards}
              owners={owners}
              activeStages={ACTIVE_STAGES}
              closedStages={CLOSED_STAGES}
              now={Date.now()}
              actions={editable ? CLIENT_PIPELINE_ACTIONS : undefined}
              links={{ person: "/client/candidates" }}
            />
          )}
        </Section>
      )}
    </Page>
  );
}
