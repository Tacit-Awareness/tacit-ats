import Link from "next/link";
import { MarkSeen } from "@/components/app-shell/shell-memory";
import { FlashToast } from "@/components/flash-toast";
import { Notice, Page, PageBar, Section, textLink } from "@/components/page";
import { readSender } from "@/lib/client/email";
import { stageLabel } from "@/lib/client/crm-views";
import { readDecisionLoop, readDone, readDoneStory, readInbox, readIssue, readIssueName, type DecisionLoop } from "@/lib/client/inbox";
import { inboxHref, parseRange, rowAfter, selectedRow } from "@/lib/client/inbox-digest";
import { decisionProps, offerTermLines } from "@/lib/client/inbox-decisions";
import { doneCandidateHref, isIssueKey, selectedDone, type DoneItem } from "@/lib/client/inbox-done";
import { readDigest } from "@/lib/client/inbox-feed";
import { candidateHref, issueFix, issueLine, nextIssue, secondaryLink, selectedIssue, waitingSince, type Issue, type IssueFix } from "@/lib/client/inbox-issues";
import { hiddenOn, lastHeld } from "@/lib/client/interview-loop";
import { webMailer } from "@/lib/client/mailer";
import { ago } from "@/lib/client/pipeline-columns";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { CandidateBody } from "../candidates/[id]/view";
import { readCandidateView } from "../candidates/[id]/read";
import { feedbackCards, loopProps } from "../interviews/loop-props";
import { Refusal } from "../refusal";
import { DoneView } from "./done-view";
import { INBOX_ERRORS, INBOX_NOTICES, isInboxError, isInboxNotice, movedToast } from "./messages";
import { UndoToast } from "./set-aside";
import { InboxView, type Standing, type TicketLoop } from "./view";

// The Inbox (design/tats's #inbox): what is stuck and waiting on someone, one
// digest card. lib/client/inbox.ts reads on the member's own token, lib/client/
// inbox-issues.ts computes the queue, lib/client/inbox-feed.ts what happened
// lately, view.tsx draws them; this file words the issue's card. `?range=` is
// how far back the digest goes (Needs you doesn't depend on it). `?i=` opens an
// issue in the pop-up, and only then is it read in full. `?open=` opens a digest
// row's candidate the same way, checked against the rows this member's own read
// just listed, as the Pipeline's `?open=` is, so a tampered id reads nothing.
// `?tab=done` is Done, where `?i=` is a dismissal's id. `?was=` names what a
// pop-up just dealt with, for the toast. An interviewer gets the pointer home.

function card(i: Issue, fix: IssueFix): { title: string; detail: string } {
  const decidable = fix.type === "decide";
  switch (i.reason) {
    case "feedback":
      return { title: "Waiting on feedback", detail: `${i.why}. Nothing here can remind them yet.` };
    case "overdue":
      return { title: i.nextAction ?? "Next action overdue", detail: `${i.why}${i.who ? ` · ${i.who}` : ""}` };
    case "quiet":
      return { title: "No touch in over a week", detail: `${i.why}${i.who ? ` · owned by ${i.who}` : ""}` };
    case "decide":
      return {
        title: "The team's call",
        detail: decidable ? `${i.why}. Next round opens their page: booking one is the client connector's schedule_interview for now.` : `${i.why}. Move them on or close them from their page.`,
      };
    case "approval":
      return { title: "Waiting on your approval", detail: `${i.who ? `Asked by ${i.who}. ` : ""}${i.why}.` };
    case "draft":
      return {
        title: "Not sent",
        detail:
          fix.type === "send" && fix.canSend
            ? "Read it, then Send here. It only goes out after you confirm."
            : "Email isn't set up on this deployment, so it can't go out from here. The client connector's send_email may still send it.",
      };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function doneNote(x: DoneItem): string | null {
  if (x.how === "resolved") return x.stands ? "It's waiting again, so it's back in your Inbox." : null;
  return x.stands ? null : "It has been dealt with since, so there's nothing to move back.";
}

const stageOf = (applications: { applicationId: string; stage: string }[], applicationId: string) => {
  const stage = applications.find((a) => a.applicationId === applicationId)?.stage;
  return stage ? stageLabel(stage) : null;
};

/** The route and the read, once a round has been held to read (design/tats's `fullBody`, which has none before one). */
function ticketLoop(read: DecisionLoop | null, candidate: string, isAdmin: boolean, now: number): TicketLoop | null {
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

/** Where an application stands, from what's on it: its next action, else its stage, and how long since anyone touched it. */
function standingOf(a: { stage: string; nextAction: string | null; nextActionDue: string | null; lastTouchAt: string }, who: string | null, now: number): Standing {
  const due = a.nextActionDue ? Date.parse(`${a.nextActionDue.slice(0, 10)}T23:59:59Z`) : null;
  const late = due !== null && due < now;
  return {
    who,
    title: a.nextAction ?? stageLabel(a.stage),
    why: !a.nextAction ? "No next action set." : late ? `${stageLabel(a.stage)}. Past its due date.` : stageLabel(a.stage),
    age: `Touched ${ago(a.lastTouchAt, now)}`,
    late,
  };
}

export default async function ClientInbox({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="Inbox" />}>
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

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const notice = one(sp.notice);
  const error = one(sp.error);
  const undo = one(sp.undo);
  const range = parseRange(one(sp.range));
  // A refusal stays beside what failed; anything else is a toast, Undo included.
  const flash = isInboxError(error) ? <Notice tone="error">{INBOX_ERRORS[error]}</Notice> : null;
  const toastOf = (text: string) => <FlashToast text={text} action={notice === "dismissed" && UUID.test(undo) ? <UndoToast id={undo} range={range} /> : undefined} />;
  const toast = !flash && isInboxNotice(notice) ? toastOf(INBOX_NOTICES[notice]) : null;

  const now = new Date();
  const nowMs = now.getTime();
  const member = { actorId, orgId: org.id, accessLevel };
  const { issues, standing, truncated, draftsCapped } = await readInbox(db, member, now);

  if (one(sp.tab) === "done") {
    const { items, capped } = await readDone(db, actorId, standing);
    const pick = selectedDone(items, one(sp.i));
    const story = pick?.candidate ? await readDoneStory(db, member, pick.candidate.id) : null;
    const how = (x: DoneItem) => `${x.how === "resolved" ? "Resolved" : "Dismissed"} ${ago(x.dismissedAt, nowMs)}`;
    return (
      <>
        {toast}
        <DoneView
          rows={items.map((x) => ({
            key: x.id,
            kind: x.kind,
            href: `/client/inbox?tab=done&i=${x.id}`,
            what: x.what,
            who: null,
            line: x.line,
            age: how(x),
            active: x.id === pick?.id,
          }))}
          item={
            pick
              ? {
                  id: pick.id,
                  what: pick.what,
                  subject: pick.line,
                  how: how(pick),
                  since: doneNote(pick),
                  canMoveBack: pick.canMoveBack,
                  candidateHref: doneCandidateHref(pick, story),
                  story,
                  now: nowMs,
                }
              : null
          }
          flash={flash}
          open={pick !== null && pick.id === one(sp.i)}
          capped={capped}
        />
      </>
    );
  }

  const digest = await readDigest(db, range, now, issues.length);
  const open = selectedIssue(issues, one(sp.i));
  const detail = open ? await readIssue(db, member, open) : null;
  const mailer = webMailer();
  const fix = open ? issueFix(open, detail?.canEdit ?? false, mailer !== null) : null;
  const sender = open?.draft ? await readSender(db, toolCtx(gate.ctx), mailer) : null;
  const decision = open && fix ? decisionProps(fix, open, detail?.reasons ?? []) : null;

  // Nothing about a candidate is read until their row is open. An issue wins over a row.
  const openRow = open ? null : selectedRow(digest.groups, one(sp.open));
  const openPerson = openRow ? await readCandidateView(gate.ctx, openRow.candidate.id, nowMs) : null;
  const shownRow = openPerson ? openRow : null;
  // An approver not on the job has neither their page nor the loop, so keeps the reader.
  const whole = open?.candidate && detail?.canOpen ? await readCandidateView(gate.ctx, open.candidate.id, nowMs) : null;
  const loop = open && whole && open.job.id && open.applicationId ? await readDecisionLoop(db, member, { jobId: open.job.id, applicationId: open.applicationId }) : null;
  const personApp = openPerson && shownRow ? openPerson.candidate.applications.find((a) => a.applicationId === shownRow.applicationId) : null;
  const personLoop = shownRow && personApp ? await readDecisionLoop(db, member, { jobId: personApp.jobId, applicationId: shownRow.applicationId }) : null;

  const walk = [...issues.map((i) => i.key), ...digest.groups.flatMap((g) => g.rows.map((r) => r.id))];

  // What a pop-up just dealt with, by key: its name is read like any Done row, on the member's own token.
  const was = one(sp.was);
  const moved =
    toast && isInboxNotice(notice) && isIssueKey(was)
      ? movedToast(notice, { name: await readIssueName(db, actorId, was, standing), next: open ? (open.candidate?.name ?? open.job.title) : null, caughtUp: issues.length === 0 })
      : null;

  return (
    <>
      <MarkSeen mark="inbox" ids={issues.map((i) => i.key)} />
      {moved ? toastOf(moved) : toast}
      <InboxView
        rows={issues.map((i) => ({
          key: i.key,
          kind: i.kind,
          href: inboxHref(range, i.key),
          what: i.what,
          who: i.who,
          line: issueLine(i),
          age: ago(waitingSince(i), nowMs),
          active: i.key === open?.key,
          instance: { key: i.key, reason: i.reason, at: i.at },
          // An approver may not be on the job, and a row can't ask without a read per row.
          page: i.candidate && i.reason !== "approval" ? candidateHref(i) : null,
          next: rowAfter(walk, i.key),
        }))}
        issue={
          open && fix
            ? {
                kind: open.kind,
                instance: { key: open.key, reason: open.reason, at: open.at },
                what: open.what,
                subject: [open.candidate?.name, open.job.title].filter(Boolean).join(" · "),
                card: card(open, fix),
                draft: open.draft ? { to: open.draft.toEmail, subject: open.draft.subject, body: open.draft.body, from: sender?.from ?? null, replyTo: sender?.replyTo ?? null } : null,
                fix,
                decision,
                terms: detail?.terms ? offerTermLines(detail.terms) : null,
                next: nextIssue(issues, open.key)?.key ?? null,
                secondary: secondaryLink(open, fix, detail?.canOpen ?? true),
                who: open.who,
                age: `Waiting ${ago(waitingSince(open), nowMs)}`,
                page: (detail?.canOpen ?? true) ? candidateHref(open) : null,
                story: open.candidate ? (detail?.story ?? null) : null,
                ticket:
                  whole && open.candidate
                    ? {
                        title: open.candidate.name,
                        subject: [open.job.title, open.applicationId ? stageOf(whole.candidate.applications, open.applicationId) : null].filter(Boolean).join(" · "),
                        loop: ticketLoop(loop, open.candidate.name, accessLevel === "admin", nowMs),
                        body: (call) => <CandidateBody {...whole} notice={null} error={null} call={call} />,
                      }
                    : null,
                now: nowMs,
              }
            : null
        }
        person={
          shownRow && openPerson
            ? {
                key: shownRow.id,
                title: shownRow.candidate.name,
                subject: [shownRow.jobTitle, stageOf(openPerson.candidate.applications, shownRow.applicationId)].filter(Boolean).join(" · "),
                page: shownRow.page,
                loop: ticketLoop(personLoop, shownRow.candidate.name, accessLevel === "admin", nowMs),
                standing: personApp ? standingOf(personApp, openPerson.owners[personApp.applicationId] ?? null, nowMs) : null,
                body: (call) => <CandidateBody {...openPerson} notice={null} error={null} call={call} />,
              }
            : null
        }
        flash={flash}
        home={inboxHref(range)}
        truncated={truncated}
        draftsCapped={draftsCapped}
        digest={{
          range,
          asOf: now.toISOString(),
          total: digest.total,
          shown: digest.shown,
          sources: digest.sources,
          unread: digest.unread.length,
          capped: digest.capped,
          groups: digest.groups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, age: ago(r.at, nowMs), active: r.id === shownRow?.id, next: rowAfter(walk, r.id) })) })),
        }}
      />
    </>
  );
}
