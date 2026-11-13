"use client";

import { PopUp } from "@/components/pop-up";

// A person over the Pipeline's list (design/tats's `plOpen`, `openFull`), holding
// the candidate's dashboard: components/pop-up.tsx, with `?open=` its state, so J
// and K walk the rows behind it. Closed, focus goes back to the row. Its head
// carries the name alone (no subject line): the dashboard's own head names the
// job, and its side card where they stand, so the head would only say them again.

const rowSelector = (id: string) => `[data-pop-row="${id.replace(/["\\]/g, "\\$&")}"]`;

export function PersonPopup({ applicationId, title, subject = "", home, pageHref, children }: { applicationId: string; title: string; subject?: string; home: string; pageHref: string; children: React.ReactNode }) {
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
