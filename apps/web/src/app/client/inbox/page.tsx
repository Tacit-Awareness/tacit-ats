import Link from "next/link";
import { MarkSeen } from "@/components/app-shell/shell-memory";
import { Notice, Page, PageBar, Section, textLink } from "@/components/page";
import { readSender } from "@/lib/client/email";
import { readDone, readDoneStory, readInbox, readIssue } from "@/lib/client/inbox";
import { decisionProps, offerTermLines } from "@/lib/client/inbox-decisions";
import { doneCandidateHref, selectedDone, type DoneItem } from "@/lib/client/inbox-done";
import { issueFix, issueLine, nextIssue, secondaryLink, selectedIssue, waitingSince, type Issue, type IssueFix } from "@/lib/client/inbox-issues";
import { webMailer } from "@/lib/client/mailer";
import { ago } from "@/lib/client/pipeline-columns";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { Refusal } from "../refusal";
import { DoneView } from "./done-view";
import { INBOX_ERRORS, INBOX_NOTICES, isInboxError, isInboxNotice } from "./messages";
import { UndoNotice } from "./set-aside";
import { InboxView } from "./view";

// The Inbox (design/tats's #inbox): what is stuck and waiting on someone, by
// kind. lib/client/inbox.ts reads on the member's own token, lib/client/
// inbox-issues.ts computes the queue, view.tsx draws it; this file words the
// reader's card. `?i=` picks the issue, `?tab=done` the Done tab, where `?i=` is
// a dismissal's id. An interviewer gets the pointer home.

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
  const flash = isInboxError(error) ? (
    <Notice tone="error">{INBOX_ERRORS[error]}</Notice>
  ) : isInboxNotice(notice) ? (
    notice === "dismissed" && UUID.test(undo) ? (
      <UndoNotice id={undo}>{INBOX_NOTICES[notice]}</UndoNotice>
    ) : (
      <Notice>{INBOX_NOTICES[notice]}</Notice>
    )
  ) : null;

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
    );
  }

  const open = selectedIssue(issues, one(sp.i));
  const detail = open ? await readIssue(db, member, open) : null;
  const mailer = webMailer();
  const fix = open ? issueFix(open, detail?.canEdit ?? false, mailer !== null) : null;
  const sender = open?.draft ? await readSender(db, toolCtx(gate.ctx), mailer) : null;
  const decision = open && fix ? decisionProps(fix, open, detail?.reasons ?? []) : null;

  return (
    <>
      <MarkSeen mark="inbox" ids={issues.map((i) => i.key)} />
      <InboxView
        rows={issues.map((i) => ({
          key: i.key,
          kind: i.kind,
          href: `/client/inbox?i=${i.key}`,
          what: i.what,
          who: i.who,
          line: issueLine(i),
          age: ago(waitingSince(i), nowMs),
          active: i.key === open?.key,
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
                story: open.candidate ? (detail?.story ?? null) : null,
                now: nowMs,
              }
            : null
        }
        flash={flash}
        open={open !== null && open.key === one(sp.i)}
        truncated={truncated}
        draftsCapped={draftsCapped}
      />
    </>
  );
}
