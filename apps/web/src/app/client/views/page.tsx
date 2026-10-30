import Link from "next/link";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { resolveClient } from "@/lib/client/session";
import { readViews } from "@/lib/client/views";
import { Refusal } from "../refusal";
import { ViewsView } from "./view";

// Views (design/tats's #views): the pages you visit now and then, and saved
// Pipeline filters to pin to the sidebar. The views are in this browser
// (lib/saved-views.ts), so this page only reads what the browser needs to count
// them and to offer in New view, on the member's own token (lib/client/
// views.ts). An interviewer has no Pipeline, so no views: the pointer home.

export default async function ClientViews() {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="Views" />}>
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

  return <ViewsView {...await readViews(db, { actorId, orgId: org.id, accessLevel }, new Date())} />;
}
