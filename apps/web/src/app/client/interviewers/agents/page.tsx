import { Page, PageBar, Pill } from "@/components/page";
import { InterviewersViewSwitch } from "../view-switch";
import { readAgentMap, type AgentMap } from "@/lib/client/agent-map";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../../refusal";
import { StateMark } from "./parts";
import { AgentsBoard } from "./view";

// Interviewers > Agents: who each interviewer is, the agent that works for
// them (the team's bot, on their behalf), and which agent is waiting on whose
// right now. Read with the signed-in member's own token
// (lib/client/agent-map.ts): an admin sees every task, anyone else the tasks
// of the jobs they can see and the ones serving them. Nothing here writes.
// The title is the Interviewers page's own, so a People / Agents switch can
// sit beside it on both.

/** The title row's facts, each labelled, only the ones there are: "2 working", "1 needs you". */
function Facts({ counts }: { counts: AgentMap["counts"] }) {
  const facts = [
    { n: counts.working, words: "working", key: "working", tone: "blue" as const, state: "working" as const },
    { n: counts.waiting, words: "waiting on someone", key: "waiting", tone: "amber" as const, state: "waiting" as const },
    { n: counts.needsYou, words: counts.needsYou === 1 ? "needs you" : "need you", key: "needs_you", tone: "red" as const, state: "needs_you" as const },
    { n: counts.failed, words: "failed", key: "failed", tone: "red" as const, state: "failed" as const },
  ].filter((f) => f.n > 0);
  // The same squares the cards' chips draw, so a fact and the chips it counts look alike.
  return facts.map((f) => (
    <Pill key={f.key} tone={f.tone} className="gap-1.5 pl-1.5 tabular-nums">
      <StateMark state={f.state} className="size-3" />
      {`${f.n} ${f.words}`}
    </Pill>
  ));
}

export default async function ClientInterviewerAgents() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, accessLevel } = gate.ctx;
  const now = new Date();
  const map = await readAgentMap(db, { accessLevel }, now);

  return (
    <Page
      bar={
        <PageBar title="Interviewers" lead={<InterviewersViewSwitch current="agents" />}>
          <Facts counts={map.counts} />
        </PageBar>
      }
    >
      <AgentsBoard map={map} now={now.getTime()} setUpHref={accessLevel === "admin" ? "/client/settings#bot" : null} />
    </Page>
  );
}
