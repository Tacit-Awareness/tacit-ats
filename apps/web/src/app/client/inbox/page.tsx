import Link from "next/link";
import { MarkSeen } from "@/components/app-shell/shell-memory";
import { FlashToast } from "@/components/flash-toast";
import { Notice, Page, PageBar, Section, textLink } from "@/components/page";
import { readSender } from "@/lib/client/email";
import { readDone, readDoneStory, readInbox, readIssue } from "@/lib/client/inbox";
import { inboxHref, parseRange } from "@/lib/client/inbox-digest";
import { decisionProps, offerTermLines } from "@/lib/client/inbox-decisions";
import { doneCandidateHref, selectedDone, type DoneItem } from "@/lib/client/inbox-done";
import { readDigest } from "@/lib/client/inbox-feed";
import { candidateHref, issueFix, issueLine, nextIssue, secondaryLink, selectedIssue, waitingSince, type Issue, type IssueFix } from "@/lib/client/inbox-issues";
import { webMailer } from "@/lib/client/mailer";
import { ago } from "@/lib/client/pipeline-columns";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { Refusal } from "../refusal";
import { DoneView } from "./done-view";
import { INBOX_ERRORS, INBOX_NOTICES, isInboxError, isInboxNotice } from "./messages";
import { UndoToast } from "./set-aside";
import { InboxView } from "./view";

// The Inbox (design/tats's #inbox): what is stuck and waiting on someone, one
// digest card. lib/client/inbox.ts reads on the member's own token, lib/client/
// inbox-issues.ts computes the queue, lib/client/inbox-feed.ts what happened
// lately, view.tsx draws them; this file words the reader's card. `?range=` is
// how far back the digest goes (Needs you doesn't depend on it). `?i=` opens the
// issue in the pop-up, and only then is it read in full; `?tab=done` is the Done
// tab, where `?i=` is a dismissal's id. An interviewer gets the pointer home.

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
  if (x.how === "resolved") return x.stands ? "It's waiting again, so it's back on Open." : null;
  return x.stands ? null : "It has been dealt with since, so there's nothing to move back.";
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
  // A refusal stays beside what failed; anything else is a toast, Undo included.
  const flash = isInboxError(error) ? <Notice tone="error">{INBOX_ERRORS[error]}</Notice> : null;
  const toast = !flash && isInboxNotice(notice) ? <FlashToast text={INBOX_NOTICES[notice]} action={notice === "dismissed" && UUID.test(undo) ? <UndoToast id={undo} /> : undefined} /> : null;

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
          openCount={issues.length}
          capped={capped}
        />
      </>
    );
  }

  const range = parseRange(one(sp.range));
  const digest = await readDigest(db, range, now, issues.length);
  const open = selectedIssue(issues, one(sp.i));
  const detail = open ? await readIssue(db, member, open) : null;
  const mailer = webMailer();
  const fix = open ? issueFix(open, detail?.canEdit ?? false, mailer !== null) : null;
  const sender = open?.draft ? await readSender(db, toolCtx(gate.ctx), mailer) : null;
  const decision = open && fix ? decisionProps(fix, open, detail?.reasons ?? []) : null;

  return (
    <>
      <MarkSeen mark="inbox" ids={issues.map((i) => i.key)} />
      {toast}
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
          next: nextIssue(issues, i.key)?.key ?? null,
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
                page: (detail?.canOpen ?? true) ? candidateHref(open) : null,
                story: open.candidate ? (detail?.story ?? null) : null,
                now: nowMs,
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
          now: nowMs,
          total: digest.total,
          shown: digest.shown,
          unread: digest.unread.length,
          capped: digest.capped,
          groups: digest.groups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, age: ago(r.at, nowMs) })) })),
        }}
      />
    </>
  );
}
