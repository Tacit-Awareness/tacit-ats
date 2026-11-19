import { readSender } from "@/lib/client/email";
import { stageLabel } from "@/lib/client/crm-views";
import { readDecisionLoop, readIssue, type DecisionLoop } from "@/lib/client/inbox";
import { decisionProps, offerTermLines } from "@/lib/client/inbox-decisions";
import { candidateHref, issueFix, nextIssue, secondaryLink, waitingSince, type Issue, type IssueFix } from "@/lib/client/inbox-issues";
import { hiddenOn, lastHeld } from "@/lib/client/interview-loop";
import { webMailer } from "@/lib/client/mailer";
import { ago } from "@/lib/client/pipeline-columns";
import type { ClientContext } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { CandidateBody } from "../candidates/[id]/view";
import { readCandidateView } from "../candidates/[id]/read";
import { feedbackCards, loopProps } from "../interviews/loop-props";
import type { IssueReaderProps, TicketLoop } from "./view";

// One Inbox issue read in full and worded for its card: the issue's own
// controls (the decision, the fix, the send), the candidate under it, and the
// route. The Inbox's pop-up and Triage's middle pane both draw it from here, on
// the member's own token (lib/client/inbox.ts's readIssue, readCandidateView).

/** Between the facts of a pop-up's subject line: a wide space, as Testbench puts no dot between facts. */
export const GAP = "\u2003";

/**
 * The card's words: `detail` is what is so, shown on the card; `hint` is how the
 * fix deals with it, the fix button's hover rather than a line under the
 * buttons. A draft that can't go out says why on the card: its button is off,
 * so it has no hover to say it on.
 */
function card(i: Issue, fix: IssueFix): { title: string; detail: string; hint?: string } {
  const decidable = fix.type === "decide";
  switch (i.reason) {
    case "feedback":
      return { title: "Waiting on feedback", detail: `${i.why}.`, hint: "Nothing here can remind them yet." };
    case "overdue":
      // Who it's with is beside the card's age ("With …"), so the line is only why.
      return { title: i.nextAction ?? "Next action overdue", detail: `${i.why}.` };
    case "quiet":
      return { title: "No touch in over a week", detail: `${i.why}.${i.who ? ` Owned by ${i.who}.` : ""}` };
    case "decide":
      return {
        title: "The team's call",
        detail: `${i.why}.`,
        hint: decidable ? "Next round finds a time for their next interview." : "Move them on or close them from their page.",
      };
    case "approval":
      return { title: "Waiting on your approval", detail: `${i.who ? `Asked by ${i.who}. ` : ""}${i.why}.` };
    case "reply":
      return { title: "They wrote back", detail: `From ${i.reply?.fromEmail ?? "the candidate"}.`, hint: "It's also forwarded to your own email. Writing to them again clears this." };
    case "draft":
      return fix.type === "send" && fix.canSend
        ? { title: "Not sent", detail: "", hint: "Read it, then Send here. It only goes out after you confirm." }
        : { title: "Not sent", detail: "Email isn't set up on this deployment, so it can't go out from here. The client connector's send_email may still send it." };
  }
}

export const stageOf = (applications: { applicationId: string; stage: string }[], applicationId: string) => {
  const stage = applications.find((a) => a.applicationId === applicationId)?.stage;
  return stage ? stageLabel(stage) : null;
};

/** The route and the read, once a round has been held to read (design/tats's `fullBody`, which has none before one). */
export function ticketLoop(read: DecisionLoop | null, candidate: string, isAdmin: boolean, now: number): TicketLoop | null {
  const held = read ? lastHeld(read.progress, now) : null;
  if (!read || !held) return null;
  const hidden = hiddenOn(read.progress, held);
  const notes = [
    read.feedback?.yoursOutstanding && !isAdmin ? "Others' feedback may stay hidden until you file yours." : null,
    hidden ? `${hidden === 1 ? "One interviewer's" : `${hidden} interviewers'`} feedback on the last round is not visible to you.` : null,
  ].filter(Boolean);
  return {
    ...loopProps({ candidate, jobTitle: read.plan.title, progress: read.progress, selectedId: held, listed: new Set(), href: () => "", stage: read.stage, routing: read.routing, isAdmin, now }),
    feedback: read.feedback ? feedbackCards(read.feedback, now) : [],
    feedbackNote: notes.length ? notes.join(" ") : null,
  };
}

/** How long an issue has waited, for its card: "Waiting 4d", or "Waiting since today". */
function waited(iso: string, now: number): string {
  const since = ago(iso, now);
  return since === "today" ? "Waiting since today" : `Waiting ${since.replace(/ ago$/, "")}`;
}


/** The issue the member opened, read in full: the card, its controls, and the candidate under it. `issues` is the order the next one is taken from. */
export async function readIssueReader(ctx: ClientContext, input: { issues: Issue[]; open: Issue; nowMs: number }): Promise<IssueReaderProps | null> {
  const { db, actorId, accessLevel, org } = ctx;
  const { issues: ordered, open, nowMs } = input;
  const member = { actorId, orgId: org.id, accessLevel };
  const detail = await readIssue(db, member, open);
  const mailer = webMailer();
  const fix = issueFix(open, detail?.canEdit ?? false, mailer !== null);
  const sender = open.draft ? await readSender(db, toolCtx(ctx), mailer) : null;
  const decision = decisionProps(fix, open, detail?.reasons ?? []);
  // An approver not on the job has neither their page nor the loop, so keeps the reader.
  const whole = open.candidate && detail?.canOpen ? await readCandidateView(ctx, open.candidate.id, nowMs) : null;
  const loop = whole && open.job.id && open.applicationId ? await readDecisionLoop(db, member, { jobId: open.job.id, applicationId: open.applicationId }) : null;
  return {
    kind: open.kind,
    instance: { key: open.key, reason: open.reason, at: open.at },
    what: open.what,
    subject: [open.candidate?.name, open.job.title].filter(Boolean).join(GAP),
    card: card(open, fix),
    draft: open.draft ? { to: open.draft.toEmail, subject: open.draft.subject, body: open.draft.body, from: sender?.from ?? null, replyTo: sender?.replyTo ?? null } : null,
    reply: open.reply ? { subject: open.reply.subject, body: detail?.replyBody ?? "" } : null,
    fix,
    decision,
    terms: detail?.terms ? offerTermLines(detail.terms) : null,
    next: nextIssue(ordered, open.key)?.key ?? null,
    secondary: secondaryLink(open, fix, detail?.canOpen ?? true),
    who: open.who,
    age: waited(waitingSince(open), nowMs),
    page: (detail?.canOpen ?? true) ? candidateHref(open) : null,
    story: open.candidate ? (detail?.story ?? null) : null,
    ticket:
      whole && open.candidate
        ? {
            title: open.candidate.name,
            subject: [open.job.title, open.applicationId ? stageOf(whole.candidate.applications, open.applicationId) : null].filter(Boolean).join(GAP),
            loop: ticketLoop(loop, open.candidate.name, accessLevel === "admin", nowMs),
            // An overdue ticket already states the next action, so the dashboard under it doesn't repeat it.
            body: (call) => <CandidateBody {...whole} notice={null} error={null} call={call} dashboard nextInCall={open.reason === "overdue" ? open.applicationId : null} />,
          }
        : null,
    now: nowMs,
  };
}

