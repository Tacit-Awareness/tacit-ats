"use client";

import { PopUp } from "@/components/pop-up";
import { rowSelector } from "@/lib/client/inbox-popup";

// One issue over the Inbox card, holding the reader: components/pop-up.tsx, with
// `?i=` its state. Closed, focus goes back to the row, or the card once the row
// has been dealt with.

export function IssuePopup({ issueKey, title, subject, home, pageHref, children }: { issueKey: string; title: string; subject: string; home: string; pageHref: string | null; children: React.ReactNode }) {
  return (
    <PopUp
      showing={issueKey}
      title={title}
      subject={subject}
      home={home}
      pageHref={pageHref}
      keysTitle="Inbox"
      closeLabel="Close, back to the Inbox"
      backTo={(key) => [rowSelector(key), "[data-inbox-card]"]}
    >
      {children}
    </PopUp>
  );
}
