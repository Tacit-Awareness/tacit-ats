import { MarkSeen } from "@/components/app-shell/shell-memory";
import { attentionOf, logRow } from "@/lib/client/bot-activity";
import { LOG_MAX, commandableTasks, readBotLog, readBotNeedsYou } from "@/lib/client/bot-tasks";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { ACTIVITY_ERRORS, ACTIVITY_NOTICES, isActivityError, isActivityNotice } from "./messages";
import { ActivityView } from "./view";

// Grokbot Activity (design/tats's #activity): what needs you first, then a
// searchable log, from `bot_tasks` on the member's own token. Every level may
// open it, an interviewer included: the policy shows each member the tasks they
// can read, and the fix only appears for who bot_task_command would let press
// it. lib/client/bot-tasks.ts reads, lib/client/bot-activity.ts words it.

export default async function ClientActivity({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId } = gate.ctx;

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const notice = one(sp.notice);
  const error = one(sp.error);

  const now = new Date();
  const nowMs = now.getTime();
  const [needs, log] = await Promise.all([readBotNeedsYou(db, now), readBotLog(db)]);
  const canAct = await commandableTasks(db, needs.tasks);
  // Oldest first, as the prototype: what has waited longest is on top.
  const waiting = [...needs.tasks].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));

  return (
    <>
      <MarkSeen mark="activity" ids={needs.tasks.map((t) => t.id)} />
      <ActivityView
        todos={waiting.map((t) => ({
          attention: attentionOf(t, actorId, nowMs),
          href: t.candidate ? `/client/candidates/${t.candidate.id}` : null,
          canAct: canAct.has(t.id),
        }))}
        todosCapped={needs.capped}
        log={log.tasks.map((t) => logRow(t, actorId, nowMs))}
        logCapped={log.capped}
        logMax={LOG_MAX}
        now={nowMs}
        notice={isActivityNotice(notice) ? ACTIVITY_NOTICES[notice] : null}
        error={isActivityError(error) ? ACTIVITY_ERRORS[error] : null}
      />
    </>
  );
}
