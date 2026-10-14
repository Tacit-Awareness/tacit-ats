import Link from "next/link";
import { notFound } from "next/navigation";
import { ACTIVE_STAGES, APPLICATION_STAGES, getRolePipeline } from "@tacit/core";
import { PipelineBoard } from "@/components/pipeline-board";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../refusal";
import { JOB_ERRORS, JOB_NOTICES, isJobError, isJobNotice } from "../messages";
import { addCandidateAction } from "./actions";
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;

  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { notice, error } = await searchParams;
  const { db, accessLevel } = gate.ctx;

  const [pipeline, canEdit, canAddPeople, team, role] = await Promise.all([
    getRolePipeline(db, id),
    db.rpc("can_on_role", { p_role: id, perm: "can_edit_pipeline" }),
    db.rpc("can_add_people"),
    db.from("org_members").select("id, display_name").order("display_name"),
    db.from("roles").select("location, seniority").eq("id", id).maybeSingle(),
  ]);
  if (!pipeline) notFound();
  for (const r of [canEdit, canAddPeople, team, role]) if (r.error) throw new Error(r.error.message);

  const editable = canEdit.data === true;
  // Adding someone new makes their person row first, which needs both.
  const canAdd = editable && canAddPeople.data === true;
  const cards = pipeline.cards.map((c) => ({ ...c, roleId: pipeline.roleId, roleTitle: pipeline.roleTitle }));
  const owners = (team.data ?? []).map((m) => ({ actorId: m.id!, name: m.display_name ?? "" }));
  const details = [role.data?.seniority, role.data?.location].filter(Boolean).join(" · ");

  return (
    <main className="space-y-8">
      <div>
        <Link href="/client/jobs" className="text-sm text-muted-foreground hover:text-foreground">
          ← Jobs
        </Link>
        <div className="mt-3 flex items-baseline gap-3">
          <h1 className="text-2xl font-medium">{pipeline.roleTitle}</h1>
          <span className="text-xs text-muted-foreground">{pipeline.roleStatus}</span>
        </div>
        {details ? <p className="mt-1 text-sm text-muted-foreground">{details}</p> : null}
      </div>

      {isJobNotice(notice) ? <p className="text-sm text-positive">{JOB_NOTICES[notice]}</p> : null}
      {isJobError(error) ? <p className="text-sm text-negative">{JOB_ERRORS[error]}</p> : null}

      {accessLevel === "limited" ? (
        <p className="text-[15px] text-muted-foreground">
          You&apos;re an interviewer on this job. The people you interview are on your{" "}
          <Link href="/client" className="underline underline-offset-4">
            home page
          </Link>
          .
        </p>
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Pipeline ({cards.length})</h2>
            {pipeline.stalledCount > 0 && <Badge variant="negative">{pipeline.stalledCount} need attention</Badge>}
          </div>
          {cards.length === 0 ? (
            <p className="text-[15px] text-muted-foreground">Nobody is in this job&apos;s pipeline yet.</p>
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

      {canAdd ? (
        <section className="max-w-xl space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Add a candidate</h2>
          <form action={addCandidateAction} className="space-y-3 rounded-lg border border-border p-4">
            <input type="hidden" name="roleId" value={pipeline.roleId} />
            <label className="block space-y-1 text-xs text-muted-foreground">
              Name
              <Input name="name" required maxLength={200} autoComplete="off" />
            </label>
            <label className="block space-y-1 text-xs text-muted-foreground">
              Email (optional; someone already in your records with this address is reused)
              <Input name="email" type="email" maxLength={320} autoComplete="off" />
            </label>
            <label className="block space-y-1 text-xs text-muted-foreground">
              LinkedIn (optional)
              <Input name="linkedinUrl" placeholder="linkedin.com/in/…" maxLength={500} autoComplete="off" />
            </label>
            <SubmitButton variant="outline" size="sm" pendingLabel="Adding…">
              Add to pipeline
            </SubmitButton>
          </form>
        </section>
      ) : null}
    </main>
  );
}
