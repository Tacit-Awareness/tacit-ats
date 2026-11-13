import Link from "next/link";
import { notFound } from "next/navigation";
import { ACTIVE_STAGES, APPLICATION_STAGES, getRolePipeline } from "@tacit/core";
import { PipelineBoard } from "@/components/pipeline-board";
import { Empty, Page, PageBar, Pill, Section, textLink } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../refusal";
import { CLIENT_PIPELINE_ACTIONS } from "./board-actions";

// One job and its pipeline, read with the signed-in member's own token. What
// the board holds is what the policies let them read (every candidate for an
// admin or the hiring team, only their own adds for an external recruiter,
// none for an interviewer), and the edit controls appear only where they may
// write (can_edit_pipeline on this job). Nothing is filtered here. The title
// row reads as Testbench's review header: the job's status tag and its facts
// beside the title, each fact with its own bare icon so they never run
// together, and the one action (its post) on the right.

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
  const seniority = role.data?.seniority ?? null;
  const location = role.data?.location ?? null;

  return (
    <Page
      bar={
        <PageBar
          crumbs={[{ href: "/client/jobs", label: "Job Postings" }]}
          title={pipeline.roleTitle}
          lead={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
              <StatusBadge status={pipeline.roleStatus} />
              {seniority ? (
                <Fact title="Seniority" d="M3 13h10M5 13V8.5M8 13V5.5M11 13V3">
                  <span className="inline-block first-letter:uppercase">{seniority}</span>
                </Fact>
              ) : null}
              {location ? (
                <Fact title="Location" d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14ZM8 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z">
                  {location}
                </Fact>
              ) : null}
            </div>
          }
        >
          <Link href={`/client/jobs/${pipeline.roleId}/post`} className={buttonVariants({ variant: "outline" })}>
            Job post
          </Link>
        </PageBar>
      }
    >
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
            // The board scrolls sideways; its scroller runs to the card's edges so a
            // column slides out under the edge rather than stopping short of it.
            <div className="-mx-5 min-w-0 [&>div]:mx-0 [&>div]:px-5">
              <PipelineBoard
                cards={cards}
                owners={owners}
                activeStages={ACTIVE_STAGES}
                closedStages={CLOSED_STAGES}
                now={Date.now()}
                actions={editable ? CLIENT_PIPELINE_ACTIONS : undefined}
                links={{ person: "/client/candidates" }}
              />
            </div>
          )}
        </Section>
      )}
    </Page>
  );
}

/** One fact of the job beside its title: a bare 14px icon, then the value; the icon's meaning is the hover title. */
function Fact({ title, d, children }: { title: string; d: string; children: React.ReactNode }) {
  return (
    <span title={title} className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0 text-[color:var(--ink-4)]" aria-hidden>
        <path d={d} />
      </svg>
      {children}
    </span>
  );
}
