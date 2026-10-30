import type { Db } from "@tacit/db";

import { connector, logTouch, renderTemplate } from "@tacit/core";
import { withAudit } from "./audit.js";
import { ClientToolError, LIST_MAX, type ClientToolCtx } from "./context.js";

/**
 * Candidate email for the client connector (20261016100000_client_email):
 * per-org templates, and email to a candidate that is always two steps, as on
 * Tacit's own connector. draftEmail writes a candidate_emails row holding
 * exactly what would go out; sendEmail sends that row and nothing else. Same
 * rules as the rest of client-tools: the member's own client, and the
 * policies decide (templates: read above interviewer, written by admins;
 * emails: written by whoever can_edit_person, sent by their author only).
 * The checks here ask first only to answer with a sentence.
 *
 * Delivery is injected (ClientMailer): the staff connector's Resend sender
 * (connector/email.ts makeResendSender), From a Tacit-controlled address
 * with the member's name in the display name and Reply-To the member's own
 * address, since a client's domain is not one Tacit can send from. The
 * subject and body stay out of every audit row.
 */

export const TEMPLATE_NAME_MAX = 100;
export const EMAIL_SUBJECT_MAX = 300;
export const EMAIL_BODY_MAX = 20000;
/** Enforced by the validate_candidate_email trigger; named here for the sentence. */
export const CLIENT_SENDS_PER_HOUR = 30;
const TEMPLATES_READ_MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a template or a draft may say in {{...}}, and what fills it. */
export const EMAIL_PLACEHOLDERS = {
  candidate_first_name: "the candidate's first name",
  candidate_name: "the candidate's full name",
  job_title: "the job's title (needs application_id)",
  company_name: "your company's name",
  sender_name: "your name",
  sender_first_name: "your first name",
} as const;
export type EmailPlaceholder = keyof typeof EMAIL_PLACEHOLDERS;
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Delivery, injected. Null in place of the whole thing = candidate email is
 * turned off on this deployment (CLIENT_EMAIL_DISABLED); `send` null = drafts
 * work and nothing can be sent (no provider key).
 */
export type ClientMailer = {
  send: connector.EmailSender | null;
  /** The Tacit-controlled address every client email is From, e.g. hiring@tacitawareness.com. */
  fromAddress: string;
};

const turnedOff = (what: string) =>
  new ClientToolError("forbidden", `Candidate email is turned off on this Tacit deployment. ${what}`);
const notForInterviewers = () => new ClientToolError("forbidden", "Interviewers do not email candidates or see their email.");
const candidateNotFound = () =>
  new ClientToolError("not_found", "No candidate with that id that you can see. Call search_candidates for the ids.");

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type EmailTemplate = {
  templateId: string;
  name: string;
  subject: string;
  body: string;
  archived: boolean;
  updatedAt: string;
};

type TemplateRow = { id: string; name: string; subject: string; body: string; archived_at: string | null; updated_at: string };

const toTemplate = (t: TemplateRow): EmailTemplate => ({
  templateId: t.id, name: t.name, subject: t.subject, body: t.body, archived: t.archived_at !== null, updatedAt: t.updated_at,
});

async function readTemplates(db: Db): Promise<TemplateRow[]> {
  const { data, error } = await db
    .from("email_templates").select("id, name, subject, body, archived_at, updated_at").order("name").limit(TEMPLATES_READ_MAX);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The template a member named, by id or by name ignoring case; archived ones included. */
async function findTemplate(db: Db, ref: string): Promise<TemplateRow | null> {
  const wanted = ref.trim();
  if (!wanted) return null;
  const rows = await readTemplates(db);
  if (UUID.test(wanted)) return rows.find((r) => r.id === wanted.toLowerCase()) ?? null;
  const key = wanted.replace(/\s+/g, " ").toLowerCase();
  return rows.find((r) => r.name.toLowerCase() === key) ?? null;
}

/** The placeholders a text names that Tacit does not fill. */
function unknownPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))].filter((n) => !(n in EMAIL_PLACEHOLDERS));
}

const PLACEHOLDER_LIST = Object.keys(EMAIL_PLACEHOLDERS).map((k) => `{{${k}}}`).join(", ");

function templateName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new ClientToolError("invalid", "A template needs a name.");
  if (name.length > TEMPLATE_NAME_MAX) throw new ClientToolError("invalid", `A template's name is at most ${TEMPLATE_NAME_MAX} characters.`);
  return name;
}

/** A subject is one line; a body is any text. Both checked for size and for placeholders Tacit cannot fill. */
function checkContent(input: { subject?: string; body?: string }): { subject?: string; body?: string } {
  const out: { subject?: string; body?: string } = {};
  if (input.subject !== undefined) {
    const subject = input.subject.replace(/[\r\n]+/g, " ").trim();
    if (!subject) throw new ClientToolError("invalid", "An email needs a subject.");
    if (subject.length > EMAIL_SUBJECT_MAX) throw new ClientToolError("invalid", `A subject is at most ${EMAIL_SUBJECT_MAX} characters.`);
    out.subject = subject;
  }
  if (input.body !== undefined) {
    const body = input.body.replace(/\r\n?/g, "\n");
    if (!body.trim()) throw new ClientToolError("invalid", "An email needs a body.");
    if (body.length > EMAIL_BODY_MAX) throw new ClientToolError("invalid", `A body is at most ${EMAIL_BODY_MAX} characters.`);
    out.body = body;
  }
  const unknown = unknownPlaceholders(`${out.subject ?? ""}\n${out.body ?? ""}`);
  if (unknown.length) {
    throw new ClientToolError("invalid", `Tacit fills only these placeholders: ${PLACEHOLDER_LIST}. Remove or fix the others.`);
  }
  return out;
}

export async function listEmailTemplates(
  db: Db,
  ctx: ClientToolCtx,
  input: { includeArchived?: boolean } = {},
): Promise<EmailTemplate[]> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  let q = db.from("email_templates").select("id, name, subject, body, archived_at, updated_at").order("name").limit(TEMPLATES_READ_MAX);
  if (!input.includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(toTemplate);
}

const adminsOnly = () => new ClientToolError("forbidden", "Only an admin at your company makes or changes email templates.");

export async function createEmailTemplate(
  db: Db,
  ctx: ClientToolCtx,
  input: { name: string; subject: string; body: string },
): Promise<{ templateId: string; name: string }> {
  if (ctx.accessLevel !== "admin") throw adminsOnly();
  const name = templateName(input.name);
  const { subject, body } = checkContent({ subject: input.subject, body: input.body }) as { subject: string; body: string };
  const existing = await findTemplate(db, name);
  if (existing) {
    // No name in the sentence: refusals go back unfenced.
    throw new ClientToolError(
      "invalid",
      existing.archived_at
        ? "A template by that name is archived. update_email_template with archived: false brings it back."
        : "A template by that name already exists. Change it with update_email_template.",
    );
  }
  return withAudit(db, ctx, { action: "email_template.create", entity: "email_template" }, async () => {
    // Made here and not read back, as every new row a member inserts.
    const templateId = globalThis.crypto.randomUUID();
    const { error } = await db.from("email_templates").insert({ id: templateId, name, subject, body, created_by_actor_id: ctx.actorId });
    if (error?.code === "23505") throw new ClientToolError("invalid", "A template by that name was just made. Look in list_email_templates.");
    if (error?.code === "42501") throw adminsOnly();
    if (error) throw new Error(error.message);
    // The subject and body are the member's text: the audit row keeps the name only.
    return { result: { templateId, name }, entityId: templateId, after: { name }, changed: true };
  });
}

export type TemplateChange = { outcome: "updated" | "unchanged"; templateId: string; name: string; archived: boolean; changed: string[] };

/** Renames, rewrites, archives or restores a template (admins). Archived, never deleted. */
export async function updateEmailTemplate(
  db: Db,
  ctx: ClientToolCtx,
  input: { template: string; name?: string; subject?: string; body?: string; archived?: boolean },
): Promise<TemplateChange> {
  if (ctx.accessLevel !== "admin") throw adminsOnly();
  const name = input.name === undefined ? undefined : templateName(input.name);
  const content = checkContent({ subject: input.subject, body: input.body });
  const row = await findTemplate(db, input.template);
  if (!row) throw new ClientToolError("not_found", "No email template by that name or id. list_email_templates has them.");

  const patch: { name?: string; subject?: string; body?: string; archived_at?: string | null } = {};
  if (name !== undefined && name !== row.name) {
    const clash = await findTemplate(db, name);
    if (clash && clash.id !== row.id) throw new ClientToolError("invalid", "Another template already has that name.");
    patch.name = name;
  }
  if (content.subject !== undefined && content.subject !== row.subject) patch.subject = content.subject;
  if (content.body !== undefined && content.body !== row.body) patch.body = content.body;
  if (input.archived !== undefined && input.archived !== (row.archived_at !== null)) {
    patch.archived_at = input.archived ? new Date().toISOString() : null;
  }
  const changed = Object.keys(patch).map((k) => (k === "archived_at" ? "archived" : k));
  const archived = patch.archived_at !== undefined ? patch.archived_at !== null : row.archived_at !== null;
  if (!changed.length) return { outcome: "unchanged", templateId: row.id, name: row.name, archived, changed };

  return withAudit<TemplateChange>(db, ctx, { action: "email_template.update", entity: "email_template" }, async () => {
    const { data, error } = await db.from("email_templates").update(patch).eq("id", row.id).select("id");
    if (error?.code === "23505") throw new ClientToolError("invalid", "Another template already has that name.");
    if (error) throw new Error(error.message);
    const ok = !!data?.length;
    // Names and the archive flag; which of subject and body changed, never what they say.
    return {
      result: { outcome: ok ? ("updated" as const) : ("unchanged" as const), templateId: row.id, name: patch.name ?? row.name, archived, changed: ok ? changed : [] },
      entityId: row.id,
      before: { name: row.name, archived: row.archived_at !== null },
      after: { name: patch.name ?? row.name, archived, changed },
      changed: ok,
    };
  });
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

/** The candidate's addresses the member can read: the email column, then any email identifiers. */
async function addressesOnFile(db: Db, personId: string, primary: string | null): Promise<string[]> {
  const { data, error } = await db.from("person_identifiers").select("value").eq("person_id", personId).eq("kind", "email");
  if (error) throw new Error(error.message);
  const all = [primary, ...(data ?? []).map((r) => r.value)].map((e) => e?.trim().toLowerCase());
  return [...new Set(all.filter((e): e is string => connector.isPlainEmail(e)))];
}

/** Who the email is from: the member's name at the company, and their own address for replies. Exported so apps/web can show it on a draft before Send. */
export async function senderFor(db: Db, ctx: ClientToolCtx, mailer: ClientMailer) {
  const [me, org] = await Promise.all([
    db.from("org_members").select("display_name, email").eq("id", ctx.actorId).maybeSingle(),
    db.from("orgs").select("name").eq("id", ctx.orgId).maybeSingle(),
  ]);
  for (const r of [me, org]) if (r.error) throw new Error(r.error.message);
  const replyTo = me.data?.email?.trim().toLowerCase();
  if (!connector.isPlainEmail(replyTo)) {
    throw new ClientToolError("invalid", "Your email address is not on file in Tacit, so a candidate's reply would have nowhere to go. Nothing was written or sent.");
  }
  const name = me.data?.display_name?.trim() || null;
  const company = org.data?.name?.trim() || null;
  const display = name && company ? `${name} at ${company}` : (name ?? company ?? "");
  return { name, company, replyTo, from: connector.fromHeader(display, mailer.fromAddress) };
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? "";

export type DraftEmailResult = {
  draftId: string;
  candidateId: string;
  applicationId: string | null;
  templateId: string | null;
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  body: string;
};

/**
 * Writes a draft to a candidate, from a template or from text, and sends
 * nothing. The recipient is an address on file for them (the first, or
 * `toEmail` when it is one of them); the stored subject and body are exactly
 * what send_email would deliver, placeholders filled. Any placeholder that
 * cannot be filled refuses the draft rather than leaving "{{job_title}}" in it.
 */
export async function draftEmail(
  db: Db,
  ctx: ClientToolCtx,
  mailer: ClientMailer | null,
  input: { candidateId: string; applicationId?: string; template?: string; subject?: string; body?: string; toEmail?: string },
): Promise<DraftEmailResult> {
  if (!mailer) throw turnedOff("No draft was written.");
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  if (!input.template && (input.subject === undefined || input.body === undefined)) {
    throw new ClientToolError("invalid", "Give a template (list_email_templates), or both a subject and a body.");
  }
  const given = checkContent({ subject: input.subject, body: input.body });

  const { data: person, error } = await db.from("people").select("id, display_name, email").eq("id", input.candidateId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!person) throw candidateNotFound();
  const { data: allowed, error: permError } = await db.rpc("can_edit_person", { p_person: person.id });
  if (permError) throw new Error(permError.message);
  if (allowed !== true) {
    throw new ClientToolError("forbidden", "You can see that candidate but cannot email them. Their hiring team or an admin can.");
  }

  let jobTitle: string | null = null;
  if (input.applicationId) {
    const { data, error: appError } = await db
      .from("applications").select("id, person_id, roles(title)").eq("id", input.applicationId).maybeSingle();
    if (appError) throw new Error(appError.message);
    const app = data as unknown as { id: string; person_id: string; roles: { title: string } | null } | null;
    if (!app || app.person_id !== person.id) {
      throw new ClientToolError("invalid", "That application_id is not one of this candidate's that you can see. get_candidate lists theirs.");
    }
    jobTitle = app.roles?.title ?? null;
  }

  let template: TemplateRow | null = null;
  if (input.template) {
    template = await findTemplate(db, input.template);
    if (!template) throw new ClientToolError("not_found", "No email template by that name or id. list_email_templates has them.");
    if (template.archived_at) throw new ClientToolError("invalid", "That template is archived. Pick another from list_email_templates.");
  }

  const onFile = await addressesOnFile(db, person.id, person.email);
  if (!onFile.length) {
    throw new ClientToolError("invalid", "This candidate has no email address on file, so there is nobody to write to. No draft was written.");
  }
  const wanted = input.toEmail?.trim().toLowerCase();
  if (wanted && !onFile.includes(wanted)) {
    // Safe to hand back: every entry passed isPlainEmail.
    throw new ClientToolError("invalid", `That address is not on file for this candidate. On file: ${onFile.join(", ")}.`);
  }
  const to = wanted ?? onFile[0];
  const sender = await senderFor(db, ctx, mailer);

  const vars: Record<EmailPlaceholder, string> = {
    candidate_first_name: firstName(person.display_name),
    candidate_name: person.display_name?.trim() ?? "",
    job_title: jobTitle ?? "",
    company_name: sender.company ?? "",
    sender_name: sender.name ?? "",
    sender_first_name: firstName(sender.name),
  };
  const subject = renderTemplate(given.subject ?? template!.subject, vars);
  const body = renderTemplate(given.body ?? template!.body, vars);
  const missing = [...new Set([...subject.missing, ...body.missing])];
  if (missing.length) {
    const hint = missing.includes("job_title") && !input.applicationId ? " Pass application_id for {{job_title}}." : "";
    throw new ClientToolError(
      "invalid",
      `Tacit has nothing to fill ${missing.map((m) => `{{${m}}}`).join(", ")} with for this candidate.${hint} No draft was written.`,
    );
  }
  // Re-checked filled: a candidate's name can carry a line break or push a subject past its size.
  const filled = checkContent({ subject: subject.rendered, body: body.rendered }) as { subject: string; body: string };

  return withAudit<DraftEmailResult>(db, ctx, { action: "email.draft", entity: "candidate_email" }, async () => {
    const draftId = globalThis.crypto.randomUUID();
    const { error: insertError } = await db.from("candidate_emails").insert({
      id: draftId, person_id: person.id, application_id: input.applicationId ?? null, template_id: template?.id ?? null,
      author_actor_id: ctx.actorId, to_email: to, subject: filled.subject, body: filled.body,
    });
    if (insertError?.code === "42501") {
      throw new ClientToolError("forbidden", "You cannot email this candidate. Their hiring team or an admin can.");
    }
    if (insertError?.code === "22023") {
      throw new ClientToolError("invalid", "The candidate's record changed while the draft was being written. Try again.");
    }
    if (insertError) throw new Error(insertError.message);
    return {
      result: {
        draftId, candidateId: person.id, applicationId: input.applicationId ?? null, templateId: template?.id ?? null,
        from: sender.from, replyTo: sender.replyTo, to, subject: filled.subject, body: filled.body,
      },
      entityId: draftId,
      // Who, to whom and from which template; never what it says.
      after: { candidate_id: person.id, application_id: input.applicationId ?? null, template_id: template?.id ?? null, to_email: to },
      changed: true,
    };
  });
}

const NOT_SENDABLE: Record<string, string> = {
  sending: "That email is already being sent.",
  sent: "That email was already sent. Nothing was sent again.",
  failed: "That draft failed to send earlier. Write a new one with draft_email.",
};

export type SendEmailResult = {
  emailId: string;
  candidateId: string;
  applicationId: string | null;
  to: string;
  subject: string;
  status: "sent";
  /** When Tacit handed it to the provider (the row's sent_at is stamped by the database a moment later). */
  sentAt: string;
};

/**
 * Sends one draft, by its author only, after the user has seen it and said
 * yes. The audit claim comes first, then draft -> sending as a conditional
 * update (two sends of one draft deliver one email; the database also holds
 * each member to 30 an hour), then the provider, keyed by the draft id. The
 * recipient is re-checked against the addresses on file first.
 */
export async function sendEmail(
  db: Db,
  ctx: ClientToolCtx,
  mailer: ClientMailer | null,
  input: { draftId: string },
): Promise<SendEmailResult> {
  if (!mailer) throw turnedOff("Nothing was sent.");
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  if (!mailer.send) {
    throw new ClientToolError("forbidden", "Email sending is not set up on this Tacit deployment yet, so nothing was sent. The draft is kept.");
  }
  const send = mailer.send;

  const { data, error } = await db
    .from("candidate_emails")
    .select("id, person_id, application_id, author_actor_id, to_email, subject, body, status, people(email)")
    .eq("id", input.draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const draft = data as unknown as {
    id: string; person_id: string; application_id: string | null; author_actor_id: string | null;
    to_email: string; subject: string; body: string; status: string; people: { email: string | null } | null;
  } | null;
  if (!draft) throw new ClientToolError("not_found", "No draft with that id that you can see. Write one with draft_email first.");
  if (draft.author_actor_id !== ctx.actorId) {
    throw new ClientToolError("forbidden", "That email was written by someone else; only its author can send it. Nothing was sent.");
  }
  if (draft.status !== "draft") throw new ClientToolError("invalid", NOT_SENDABLE[draft.status] ?? NOT_SENDABLE.failed);
  const onFile = await addressesOnFile(db, draft.person_id, draft.people?.email ?? null);
  if (!onFile.includes(draft.to_email)) {
    throw new ClientToolError("invalid", "The candidate's email on file has changed since this draft was written. Nothing was sent; write a new draft.");
  }
  const sender = await senderFor(db, ctx, mailer);

  type Done = { outcome: "sent"; result: SendEmailResult } | { outcome: "failed" };
  const done = await withAudit<Done>(db, ctx, { action: "email.send", entity: "candidate_email" }, async () => {
    const { data: claimed, error: claimError } = await db
      .from("candidate_emails").update({ status: "sending" }).eq("id", draft.id).eq("status", "draft").select("id");
    if (claimError?.code === "54000") {
      throw new ClientToolError("rate_limited", `You have sent ${CLIENT_SENDS_PER_HOUR} emails in the last hour, the limit. Nothing was sent; try again later.`);
    }
    if (claimError?.code === "42501") throw new ClientToolError("forbidden", "You can no longer email this candidate. Nothing was sent.");
    if (claimError) throw new Error(claimError.message);
    if (!claimed?.length) throw new ClientToolError("invalid", "That email is already being sent.");

    const before = { status: "draft" };
    let providerId: string;
    try {
      ({ id: providerId } = await send({
        from: sender.from, replyTo: sender.replyTo, to: draft.to_email, subject: draft.subject, text: draft.body,
        idempotencyKey: draft.id,
      }));
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
      const { error: failError } = await db.from("candidate_emails").update({ status: "failed", error: message }).eq("id", draft.id);
      if (failError) console.error(`[client-tools] could not mark email ${draft.id} failed:`, failError.message);
      return { result: { outcome: "failed" as const }, entityId: draft.id, before, after: { status: "failed" }, changed: true };
    }

    // The email is out. Nothing below may report it as unsent.
    const sentAt = new Date().toISOString();
    const { error: sentError } = await db.from("candidate_emails").update({ status: "sent", provider_id: providerId }).eq("id", draft.id);
    if (sentError) console.error(`[client-tools] email ${draft.id} sent, but not marked sent:`, sentError.message);
    if (draft.application_id) {
      // An email to the candidate is contact: the application is no longer stalled.
      await logTouch(db, { applicationId: draft.application_id, actorId: ctx.actorId }).catch((err) =>
        console.error(`[client-tools] email ${draft.id} sent, but the touch was not logged:`, err),
      );
    }
    return {
      result: {
        outcome: "sent" as const,
        result: {
          emailId: draft.id, candidateId: draft.person_id, applicationId: draft.application_id, to: draft.to_email,
          subject: draft.subject, status: "sent" as const, sentAt,
        },
      },
      entityId: draft.id,
      before,
      after: { status: "sent", candidate_id: draft.person_id, to_email: draft.to_email, provider_id: providerId },
      changed: true,
    };
  });
  if (done.outcome === "failed") {
    throw new ClientToolError("invalid", "The email provider refused the message, so it was not sent. Write a new draft to try again.");
  }
  return done.result;
}

export type CandidateEmail = {
  emailId: string;
  applicationId: string | null;
  templateId: string | null;
  /** The member who wrote it; null when they have left. */
  author: string | null;
  mine: boolean;
  to: string;
  subject: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
};

type EmailRow = {
  id: string; application_id: string | null; template_id: string | null; author_actor_id: string | null;
  to_email: string; subject: string; status: string; created_at: string; sent_at: string | null; body?: string;
};

const EMAIL_COLUMNS = "id, application_id, template_id, author_actor_id, to_email, subject, status, created_at, sent_at";

async function readEmails(db: Db, ctx: ClientToolCtx, personId: string, withBody: boolean): Promise<Array<CandidateEmail & { body?: string }>> {
  const { data, error } = await db
    .from("candidate_emails")
    .select(withBody ? `${EMAIL_COLUMNS}, body` : EMAIL_COLUMNS)
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(LIST_MAX);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as EmailRow[];
  const ids = [...new Set(rows.map((r) => r.author_actor_id).filter((id): id is string => !!id))];
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { data: members, error: membersError } = await db.from("org_members").select("id, display_name").in("id", ids);
    if (membersError) throw new Error(membersError.message);
    for (const m of members ?? []) if (m.id) names.set(m.id, m.display_name);
  }
  return rows.map((r) => ({
    emailId: r.id,
    applicationId: r.application_id,
    templateId: r.template_id,
    author: r.author_actor_id ? (names.get(r.author_actor_id) ?? null) : null,
    mine: r.author_actor_id === ctx.actorId,
    to: r.to_email,
    subject: r.subject,
    status: r.status,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    ...(withBody ? { body: r.body ?? "" } : {}),
  }));
}

/**
 * A candidate's emails the member can read, newest first: everything that
 * left draft, and their own drafts. Subjects only, for get_candidate.
 */
export async function emailsFor(db: Db, ctx: ClientToolCtx, personId: string): Promise<CandidateEmail[]> {
  return readEmails(db, ctx, personId, false);
}

export type CandidateEmailWithBody = CandidateEmail & { body: string };

/** A candidate's emails with their bodies, for list_emails. */
export async function listEmails(db: Db, ctx: ClientToolCtx, input: { candidateId: string }): Promise<CandidateEmailWithBody[]> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const emails = (await readEmails(db, ctx, input.candidateId, true)) as CandidateEmailWithBody[];
  if (!emails.length) {
    // No rows is either no email or no candidate: say which.
    const { data, error } = await db.from("people").select("id").eq("id", input.candidateId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw candidateNotFound();
  }
  return emails;
}
