import Link from "next/link";
import { MarkSeen } from "@/components/app-shell/shell-memory";
import { FlashToast } from "@/components/flash-toast";
import { LiveRefresh } from "@/components/live-refresh";
import { Notice, Page, PageBar, Section, textLink } from "@/components/page";
import { groupByTeam, isReferral, neighbour, type QueueEntry } from "@/lib/client/applicant-queue";
import { readApplicantQueue } from "@/lib/client/applicants";
import { readDepartments } from "@/lib/client/departments";
import { readSender } from "@/lib/client/email";
import { stageLabel } from "@/lib/client/crm-views";
import { readDecisionLoop, readDone, readDoneStory, readInbox, readIssue, readIssueName, type DecisionLoop } from "@/lib/client/inbox";
import { inboxHref, parseRange, rowAfter, selectedRow, type DigestRange } from "@/lib/client/inbox-digest";
import { decisionProps, offerTermLines } from "@/lib/client/inbox-decisions";
import { doneCandidateHref, isIssueKey, selectedDone, type DoneItem } from "@/lib/client/inbox-done";
import { readDigest } from "@/lib/client/inbox-feed";
import { candidateHref, issueFix, issueLine, nextIssue, secondaryLink, selectedIssue, waitingSince, type Issue, type IssueFix } from "@/lib/client/inbox-issues";
import { hiddenOn, lastHeld } from "@/lib/client/interview-loop";
import { webMailer } from "@/lib/client/mailer";
import { ago } from "@/lib/client/pipeline-columns";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { APPLICANT_ERRORS, APPLICANT_NOTICES, isApplicantError, isApplicantNotice } from "../applicants/messages";
import { readTicket, teamOf } from "../applicants/tickets";
import { CandidateBody } from "../candidates/[id]/view";
import { readCandidateView } from "../candidates/[id]/read";
import { feedbackCards, loopProps } from "../interviews/loop-props";
import { Refusal } from "../refusal";
import { DoneView } from "./done-view";
import { INBOX_ERRORS, INBOX_NOTICES, isInboxError, isInboxNotice, movedToast } from "./messages";
import { DIGEST_SECTION, REASON_SECTION, SECTIONS, isSectionKey } from "./sections";
import { UndoToast } from "./set-aside";
import { InboxView, type TicketLoop } from "./view";

// The Inbox (design/tats's #inbox): what is stuck and waiting on someone, who
// is newly in and what happened lately, in one card of three sections
// (sections.ts). lib/client/inbox.ts reads on the member's own token,
// lib/client/inbox-issues.ts computes the queue, lib/client/inbox-feed.ts what
// happened lately, lib/client/applicants.ts who is newly in (the same read New
// Applicants and the sidebar's mark make), view.tsx draws them; this file words
// the issue's card. `?range=` is how far back the digest goes, from a link only
// now: the card has no switch for it, and with none it is the default (Needs
// you doesn't depend on it). `?show=` opens the card on one section. `?i=`
// opens an issue in the pop-up, and only then is it read in full. `?open=`
// opens a digest row's candidate the same way, checked against the rows this
// member's own read just listed, as the Pipeline's `?open=` is, so a tampered
// id reads nothing. `?a=` opens a new applicant's ticket the same way, by its
// id in this member's own queue, read as New Applicants reads it
// (applicants/tickets.tsx's readTicket); routing or replying there posts New
// Applicants' own actions, which come back here with `?a=` on the next one and
// New Applicants' words. `?tab=done` is Done, where `?i=` is a dismissal's id.
// `?was=` names what a pop-up just dealt with, for the toast. An interviewer
// gets the pointer home.

/** Between the facts of a pop-up's subject line: a wide space, as Testbench puts no dot between facts. */
const GAP = "\u2003";

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

/** New applicants the card lists, newest first; the rest are a link away, in New Applicants. */
const NEWCOMERS_SHOWN = 4;

/** A new applicant's ticket over the card, at the range it opened from. */
function applicantHref(range: DigestRange, applicationId: string): string {
  const qs = new URLSearchParams(inboxHref(range).split("?")[1]);
  qs.set("a", applicationId);
  return `/client/inbox?${qs}`;
}

/** Their ticket in New Applicants: the pop-up's Open as a page, and the row's. */
const applicantPage = (applicationId: string) => `/client/applicants?a=${applicationId}`;

/** How someone came in, in words: a referral's referrer as written (free text, so only ever rendered as text), else the job board. */
const cameBy = (e: QueueEntry) => (isReferral(e) ? (e.referredBy ?? "Referral") : "Job board");

/** The queue New Applicants reads, on the member's own token. A failed read answers null and the card leaves the section quiet: the Inbox must never go down over it. */
async function readNewcomers(db: Parameters<typeof readApplicantQueue>[0], who: Parameters<typeof readApplicantQueue>[1]): Promise<QueueEntry[] | null> {
  try {
    return await readApplicantQueue(db, who);
  } catch (e) {
    console.error("inbox new applicants:", e instanceof Error ? e.message : "read failed");
    return null;
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

/** How long an issue has waited, for its card: "Waiting 4d", or "Waiting since today". */
function waited(iso: string, now: number): string {
  const since = ago(iso, now);
  return since === "today" ? "Waiting since today" : `Waiting ${since.replace(/ ago$/, "")}`;
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
  // New Applicants' writes from the pop-up come back on the ticket (`?a=`), or with a route's own notice once nobody is
  // left to open, and say what they say on New Applicants.
  const fromTicket = one(sp.a) !== "" || (isApplicantNotice(notice) && !isInboxNotice(notice));
  const refusal = fromTicket && isApplicantError(error) ? APPLICANT_ERRORS[error] : isInboxError(error) ? INBOX_ERRORS[error] : null;
  const said = fromTicket && isApplicantNotice(notice) ? APPLICANT_NOTICES[notice] : isInboxNotice(notice) ? INBOX_NOTICES[notice] : null;
  // A refusal stays beside what failed; anything else is a toast, Undo included.
  const flash = refusal ? <Notice tone="error">{refusal}</Notice> : null;
  const toastOf = (text: string) => <FlashToast text={text} action={notice === "dismissed" && UUID.test(undo) ? <UndoToast id={undo} range={range} /> : undefined} />;
  const toast = !flash && said ? toastOf(said) : null;

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

  const [digest, queue] = await Promise.all([readDigest(db, range, now, issues.length), readNewcomers(db, member)]);
  // Newest first, as the card lists them: routing one from its pop-up opens the one below it in this order.
  const newest = queue ? [...queue].sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt)) : [];
  const newcomers = newest.slice(0, NEWCOMERS_SHOWN);
  // The card's order, by section: what J and K walk, what takes focus after a dismiss, and which issue a fix opens next.
  const ordered = SECTIONS.flatMap((s) => issues.filter((i) => REASON_SECTION[i.reason] === s.key));
  const show = one(sp.show);
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
  const shownGroup = shownRow ? digest.groups.find((g) => g.rows.includes(shownRow)) : undefined;

  // A new applicant by their exact id in this member's own queue, as New Applicants' `?a=`; an issue or a row wins over them.
  const openApplicant = open || shownRow || !queue ? null : (newest.find((e) => e.applicationId === one(sp.a)) ?? null);
  const applicantTicket =
    openApplicant && queue
      ? await readTicket(
          gate.ctx,
          openApplicant,
          { team: teamOf(groupByTeam(queue, await readDepartments(db)), openApplicant), next: neighbour(newest, openApplicant.applicationId)?.applicationId ?? null, inbox: range },
          nowMs,
        )
      : null;

  const walk = SECTIONS.flatMap((s) => [
    ...ordered.filter((i) => REASON_SECTION[i.reason] === s.key).map((i) => i.key),
    ...digest.groups.filter((g) => DIGEST_SECTION[g.key] === s.key).flatMap((g) => g.rows.map((r) => r.id)),
  ]);

  // What a pop-up just dealt with, by key: its name is read like any Done row, on the member's own token.
  const was = one(sp.was);
  const moved =
    toast && !fromTicket && isInboxNotice(notice) && isIssueKey(was)
      ? movedToast(notice, { name: await readIssueName(db, actorId, was, standing), next: open ? (open.candidate?.name ?? open.job.title) : null, caughtUp: issues.length === 0 })
      : null;

  return (
    <>
      <MarkSeen mark="inbox" ids={issues.map((i) => i.key)} />
      <LiveRefresh />
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
              }
            : null
        }
        person={
          shownRow && openPerson
            ? {
                key: shownRow.id,
                title: shownRow.candidate.name,
                subject: [shownRow.jobTitle, stageOf(openPerson.candidate.applications, shownRow.applicationId)].filter(Boolean).join(GAP),
                page: shownRow.page,
                loop: ticketLoop(personLoop, shownRow.candidate.name, accessLevel === "admin", nowMs),
                body: (call) => <CandidateBody {...openPerson} notice={null} error={null} call={call} dashboard />,
                news: shownGroup
                  ? { what: shownRow.what, group: shownGroup.key, who: shownRow.who, at: shownRow.at, age: ago(shownRow.at, nowMs), interviewAt: shownRow.interviewAt, mark: shownRow.mark, next: rowAfter(walk, shownRow.id) }
                  : null,
              }
            : null
        }
        applicant={
          openApplicant && applicantTicket
            ? { key: openApplicant.applicationId, title: applicantTicket.name, subject: applicantTicket.jobTitle, page: applicantPage(openApplicant.applicationId), ticket: applicantTicket }
            : null
        }
        flash={flash}
        home={inboxHref(range)}
        truncated={truncated}
        draftsCapped={draftsCapped}
        show={isSectionKey(show) ? show : null}
        applicants={
          queue
            ? {
                total: queue.length,
                href: "/client/applicants",
                rows: newcomers.map((e) => ({
                  applicationId: e.applicationId,
                  href: applicantHref(range, e.applicationId),
                  page: applicantPage(e.applicationId),
                  active: e.applicationId === openApplicant?.applicationId,
                  name: e.name ?? "Unnamed applicant",
                  referral: isReferral(e),
                  job: e.jobTitle,
                  source: cameBy(e),
                  age: ago(e.appliedAt, nowMs),
                })),
              }
            : null
        }
        digest={{
          range,
          asOf: now.toISOString(),
          // Who is newly in counts as read too, in the title's hover and the reading pass.
          total: digest.total + (queue?.length ?? 0),
          shown: digest.shown + newcomers.length,
          sources: [
            ...(queue ? [{ label: "Applications", count: queue.length }] : []),
            { label: "Messages", count: issues.filter((i) => i.reason === "reply" || i.reason === "draft").length },
            ...digest.sources,
          ],
          unread: digest.unread.length,
          capped: digest.capped,
          groups: digest.groups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, age: ago(r.at, nowMs), active: r.id === shownRow?.id, next: rowAfter(walk, r.id) })) })),
        }}
      />
    </>
  );
}
