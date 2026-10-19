import Link from "next/link";
import { notFound } from "next/navigation";
import { ACTIVE_STAGES, APPLICATION_STAGES, getRolePipeline } from "@tacit/core";
import { PipelineBoard } from "@/components/pipeline-board";
import { Badge } from "@/components/ui/badge";
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
    <main className="space-y-9">
      <div>
        <Link href="/client/jobs" className="text-[14px] text-muted-foreground transition-colors hover:text-foreground">
          ← Jobs
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-[34px] leading-[1.12] tracking-[-0.01em]">{pipeline.roleTitle}</h1>
          <Badge variant={pipeline.roleStatus === "open" ? "accent" : "outline"}>{pipeline.roleStatus}</Badge>
        </div>
        {details ? <p className="mt-2 text-[15.5px] text-muted-foreground">{details}</p> : null}
      </div>

      {accessLevel === "limited" ? (
        <p className="notice max-w-xl">
          You&apos;re an interviewer on this job. The people you interview are on your{" "}
          <Link href="/client" className="inline-link">
            home page
          </Link>
          .
        </p>
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[21px] leading-[1.3]">
              Pipeline <span className="font-mono text-sm text-faint">{cards.length}</span>
            </h2>
            {pipeline.stalledCount > 0 && <Badge variant="negative">{pipeline.stalledCount} need attention</Badge>}
          </div>
          {cards.length === 0 ? (
            <p className="glass max-w-xl px-5 py-4 text-[15px] text-muted-foreground">Nobody is in this job&apos;s pipeline yet.</p>
          ) : (
            <PipelineBoard
              cards={cards}
              owners={owners}
              activeStages={ACTIVE_STAGES}
              closedStages={CLOSED_STAGES}
              now={Date.now()}
              actions={editable ? CLIENT_PIPELINE_ACTIONS : undefined}
              links={{}}
            />
          )}
        </section>
      )}

    </main>
  );
}
