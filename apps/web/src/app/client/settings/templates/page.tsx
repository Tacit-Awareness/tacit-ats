import { clientTools } from "@tacit-ats/core";
import { Page, PageBar, Section } from "@/components/page";
import { readTemplates } from "@/lib/client/email-templates";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { Refusal } from "../../refusal";
import { TEMPLATE_ERRORS, TEMPLATE_NOTICES, isTemplateError, isTemplateNotice } from "./messages";
import { TemplatesView } from "./view";
import "../settings.css";

// Settings > Email templates (view.tsx): core's listEmailTemplates on the
// member's own token, so the policies decide what is read. An admin also gets
// the archived ones, to bring back; an interviewer, who neither emails
// candidates nor reads templates, gets a sentence.
export default async function EmailTemplatesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { notice, error } = await searchParams;
  const { db, accessLevel } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page narrow className="set-page max-w-[880px]" bar={<PageBar title="Email templates" crumbs={[{ href: "/client/settings", label: "Settings" }]} />}>
        <Section>
          <p className="m-0 text-[13px] text-muted-foreground">Interviewers don&apos;t email candidates, so email templates aren&apos;t here for you.</p>
        </Section>
      </Page>
    );
  }

  const admin = accessLevel === "admin";
  const templates = await readTemplates(db, toolCtx(gate.ctx), { includeArchived: admin });
  return (
    <TemplatesView
      templates={templates}
      admin={admin}
      placeholders={Object.entries(clientTools.EMAIL_PLACEHOLDERS)}
      notice={isTemplateNotice(notice) ? TEMPLATE_NOTICES[notice] : null}
      error={isTemplateError(error) ? TEMPLATE_ERRORS[error] : null}
    />
  );
}
