import Link from "next/link";
import { MarkSeen } from "@/components/app-shell/shell-memory";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { readInbox, readIssue } from "@/lib/client/inbox";
import { decisionProps, offerTermLines } from "@/lib/client/inbox-decisions";
import { issueFix, issueLine, nextIssue, secondaryLink, selectedIssue, type Issue } from "@/lib/client/inbox-issues";
import { ago } from "@/lib/client/pipeline-columns";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { INBOX_ERRORS, INBOX_NOTICES, isInboxError, isInboxNotice } from "./messages";
import { InboxView } from "./view";

// The Inbox (design/tats's #inbox): what is stuck and waiting on someone, by
// kind. lib/client/inbox.ts reads on the member's own token, lib/client/
// inbox-issues.ts computes the queue, view.tsx draws it; this file words the
// reader's card. `?i=` picks the issue. An interviewer gets the pointer home.

function card(i: Issue, decidable: boolean): { title: string; detail: string } {
  switch (i.reason) {
    case "bot_failed":
      return { title: `${i.who} needs a hand`, detail: i.why };
    case "bot_waiting":
      return { title: `Waiting on ${i.who === "You" ? "you" : i.who}`, detail: i.why };
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
      return { title: "Not sent", detail: "Sending isn't in the web app yet: send it with the client connector's send_email." };
  }
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

  const now = new Date();
  const nowMs = now.getTime();
  const member = { actorId, orgId: org.id, accessLevel };
  const { issues, truncated, draftsCapped, botsCapped } = await readInbox(db, member, now);
  const open = selectedIssue(issues, one(sp.i));
  const detail = open ? await readIssue(db, member, open) : null;
  const fix = open ? issueFix(open, detail?.canEdit ?? false) : null;
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
          age: ago(i.at, nowMs),
          active: i.key === open?.key,
        }))}
        issue={
          open && fix
            ? {
                kind: open.kind,
                what: open.what,
                subject: [open.candidate?.name, open.job.title].filter(Boolean).join(" · "),
                card: card(open, fix.type === "decide"),
                draft: open.draft ? { to: open.draft.toEmail, subject: open.draft.subject, body: open.draft.body } : null,
                fix,
                decision,
                terms: detail?.terms ? offerTermLines(detail.terms) : null,
                bot: open.bot ? { steps: open.bot.steps, note: open.bot.attention.queued ?? open.bot.attention.missed } : null,
                next: nextIssue(issues, open.key)?.key ?? null,
                secondary: secondaryLink(open, fix, detail?.canOpen ?? true),
                story: open.candidate ? (detail?.story ?? null) : null,
                now: nowMs,
              }
            : null
        }
        notice={isInboxNotice(notice) ? INBOX_NOTICES[notice] : null}
        error={isInboxError(error) ? INBOX_ERRORS[error] : null}
        open={open !== null && open.key === one(sp.i)}
        truncated={truncated}
        draftsCapped={draftsCapped}
        botsCapped={botsCapped}
      />
    </>
  );
}
