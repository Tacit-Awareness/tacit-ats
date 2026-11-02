"use client";

import { useActionState, useState } from "react";
import { FlashToast } from "@/components/flash-toast";
import { Notice, Page, PageBar, Pill, Row, Rows, Section } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TEMPLATE_BODY_MAX, TEMPLATE_NAME_MAX, TEMPLATE_SUBJECT_MAX, type ShownTemplate } from "@/lib/client/email-template-rules";
import { archiveTemplateAction, saveTemplateAction } from "./actions";
import type { TemplateState } from "./messages";

// /client/settings/templates: the company's email templates, the ones the
// reply box on New Applicants starts from and the connector's draft_email
// takes. design/tats has no templates, so this is Settings' own card shape
// (`Section flush` around `Rows ruled`), linked from Settings. Everyone above
// interviewer reads them; an admin makes, changes, archives and brings back.
// Archived is never deleted: drafts already written from one are untouched.
// Props only, so page.tsx does the read.

const quiet = buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground" });

export function TemplatesView({
  templates,
  admin,
  placeholders,
  notice,
  error,
}: {
  templates: ShownTemplate[];
  admin: boolean;
  /** core's EMAIL_PLACEHOLDERS: what each {{name}} becomes. */
  placeholders: [string, string][];
  notice: string | null;
  error: string | null;
}) {
  const live = templates.filter((t) => !t.archived);
  const archived = templates.filter((t) => t.archived);
  // One editor open at a time: a template's id, "new", or none.
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Page narrow bar={<PageBar title="Email templates" crumbs={[{ href: "/client/settings", label: "Settings" }]} />}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <FlashToast text={notice} /> : null}
      <p className="m-0 max-w-[72ch] text-[13px] text-muted-foreground">
        Your company&apos;s reusable emails, shared by the team. Pick one in the reply box on New Applicants, or ask Claude to draft from one by name. Every email is still a draft you read before Send.
        {admin ? null : " Only an admin can make or change them."}
      </p>

      <Section
        flush
        title="Templates"
        count={live.length || undefined}
        aside={
          admin && editing !== "new" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")}>
              New template
            </Button>
          ) : null
        }
      >
        {editing === "new" ? <TemplateEditor key="new" template={null} placeholders={placeholders} close={() => setEditing(null)} /> : null}
        {live.length ? (
          <Rows ruled>
            {live.map((t) =>
              editing === t.templateId ? (
                <TemplateEditor key={t.templateId} template={t} placeholders={placeholders} close={() => setEditing(null)} />
              ) : (
                <TemplateRow key={t.templateId} template={t} admin={admin} edit={() => setEditing(t.templateId)} />
              ),
            )}
          </Rows>
        ) : editing !== "new" ? (
          <p className="m-0 px-3.5 py-3 text-[13px] text-muted-foreground">{admin ? "No templates yet. New template makes the first." : "No templates yet."}</p>
        ) : null}
      </Section>

      {admin && archived.length ? (
        <Section flush title="Archived" count={archived.length}>
          <Rows ruled>
            {archived.map((t) => (
              <TemplateRow key={t.templateId} template={t} admin={admin} />
            ))}
          </Rows>
        </Section>
      ) : null}
    </Page>
  );
}

/** One template: its name, subject and the start of its body; an admin's Edit and Archive, or Bring back. */
function TemplateRow({ template, admin, edit }: { template: ShownTemplate; admin: boolean; edit?: () => void }) {
  return (
    <Row
      title={template.name}
      sub={template.subject}
      meta={
        <>
          {template.archived ? <Pill>Archived</Pill> : null}
          {admin && edit ? (
            <button type="button" onClick={edit} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Edit
            </button>
          ) : null}
          {admin ? (
            <form action={archiveTemplateAction}>
              <input type="hidden" name="templateId" value={template.templateId} />
              <input type="hidden" name="archived" value={template.archived ? "false" : "true"} />
              <button type="submit" className={quiet}>
                {template.archived ? "Bring back" : "Archive"}
              </button>
            </form>
          ) : null}
        </>
      }
    >
      <span className="mt-1 line-clamp-2 text-[12.5px] break-words whitespace-pre-line text-faint">{template.body}</span>
    </Row>
  );
}

/** Name, subject and body; Save writes it through core, and a refusal stays here with what was typed. */
function TemplateEditor({ template, placeholders, close }: { template: ShownTemplate | null; placeholders: [string, string][]; close: () => void }) {
  const [state, action] = useActionState<TemplateState, FormData>(saveTemplateAction, {});
  const id = template?.templateId ?? "new";
  return (
    <form action={action} className="grid gap-3 border-b border-[color:var(--line)] px-3.5 py-3.5 last:border-b-0" aria-label={template ? "Edit template" : "New template"}>
      {template ? <input type="hidden" name="templateId" value={template.templateId} /> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <div className="grid gap-1.5">
        <Label htmlFor={`tpl-name-${id}`}>Name</Label>
        <Input id={`tpl-name-${id}`} name="name" required maxLength={TEMPLATE_NAME_MAX} defaultValue={template?.name} placeholder="Intro call" autoComplete="off" className="max-w-[420px]" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`tpl-subject-${id}`}>Subject</Label>
        <Input id={`tpl-subject-${id}`} name="subject" required maxLength={TEMPLATE_SUBJECT_MAX} defaultValue={template?.subject} placeholder="Your application for {{job_title}}" autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`tpl-body-${id}`}>Body</Label>
        <Textarea id={`tpl-body-${id}`} name="body" required maxLength={TEMPLATE_BODY_MAX} defaultValue={template?.body} rows={9} spellCheck placeholder={"Hi {{candidate_first_name}},\n\n…\n\n{{sender_first_name}}"} />
      </div>
      <details className="text-[12.5px] text-muted-foreground">
        <summary className="cursor-pointer select-none">Placeholders Tacit fills in</summary>
        <dl className="m-0 mt-2 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1">
          {placeholders.map(([key, what]) => (
            <div key={key} className="contents">
              <dt className="font-mono text-[12px] text-foreground">{`{{${key}}}`}</dt>
              <dd className="m-0">{what.replace(/ \(needs application_id\)$/, "")}</dd>
            </div>
          ))}
        </dl>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingLabel="Saving…">{template ? "Save" : "Make template"}</SubmitButton>
        <button type="button" onClick={close} className={quiet}>
          Cancel
        </button>
      </div>
    </form>
  );
}
