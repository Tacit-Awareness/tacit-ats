"use client";

import { PopUp } from "@/components/pop-up";

// A person over the Pipeline's list (design/tats's `plOpen`, `openFull`), holding
// the candidate page's body: components/pop-up.tsx, with `?open=` its state, so J
// and K walk the rows behind it. Closed, focus goes back to the row. The body's
// forms still answer on the candidate page, where their notice and error read;
// its note answers in place, so a note stays in here.

const rowSelector = (id: string) => `[data-pop-row="${id.replace(/["\\]/g, "\\$&")}"]`;

export function PersonPopup({ applicationId, title, subject, home, pageHref, children }: { applicationId: string; title: string; subject: string; home: string; pageHref: string; children: React.ReactNode }) {
  return (
    <PopUp
      showing={applicationId}
      title={title}
      subject={subject}
      home={home}
      pageHref={pageHref}
      keysTitle="Applicant Tickets"
      closeLabel="Close, back to the list"
      backTo={(id) => [rowSelector(id)]}
    >
      {children}
    </PopUp>
  );
}
