import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  APPLICATION_STAGES, CANDIDATE_SOURCES, SOURCE_DETAIL_MAX, UNTRUSTED_PREAMBLE, clientTools, wrapUntrusted,
  type IdentityProvider, type InvitationRevoker,
} from "@tacit/core";

// Relative and without ".js": see the note in app/api/mcp/route.ts.
import type { ClientMember } from "./session";

/**
 * The client connector's tools. Every handler reads and writes through
 * `member.db` alone, the client that carries this member's own database
 * token, so what a call sees and changes is what the policies allow that
 * member and nothing is filtered here. src/client-connector.test.ts fails if
 * anything under src/client other than bind.ts and audit.ts can reach
 * another database client.
 */

type Outcome = {
  /** One or two plain sentences for the person reading the chat. */
  summary: string;
  data: Record<string, unknown>;
  /** Every candidate the result is about, for the audit trail. */
  candidateIds: string[];
};

export type ClientHandlerDeps = {
  audit: (entry: { actorId: string; tool: string; args: unknown; personIds: string[]; ok: boolean }) => Promise<void>;
  /** The hourly distinct-candidate ceiling on reads (core's breadthExceeded over mcp_calls). */
  breadth: (actorId: string, candidateIds: string[]) => Promise<boolean>;
  /** WorkOS invitations into the member's organization. Null = invite_member refuses. */
  invitations: (IdentityProvider & InvitationRevoker) | null;
  /**
   * Candidates' files in Storage (client/files.ts): core calls it only after the
   * member's own client has read or inserted the row. Null = the file tools refuse.
   */
  files: clientTools.FileStore | null;
  /**
   * Candidate email's delivery (config.ts clientMailer: Resend, From a Tacit
   * address under the member's name). Null = draft_email and send_email refuse.
   */
  email: clientTools.ClientMailer | null;
};

/**
 * Candidate-derived text (names, headlines, profile summary, note bodies) goes
 * back fenced, as on the staff connector; ids, stages, emails, links, job
 * titles and teammates' names stay bare: the model needs them verbatim.
 */
const fence = (label: string, value: string | null): string | null =>
  value === null || value === "" ? value : wrapUntrusted(label, value);
const named = (name: string | null): string => fence("name", name) || "(no name on file)";

const uuid = (what: string) => z.string().uuid(`${what} is an id from an earlier result`);
const STAGE_LIST = APPLICATION_STAGES.join(", ");
const SOURCE_LIST = CANDIDATE_SOURCES.join(", ");
const ACCESS = { interviewer: "limited", "hiring team": "elevated", admin: "admin" } as const;
const ACCESS_HELP =
  "Access is interviewer (their own interviews and a short card on each candidate), hiring team " +
  "(the jobs they are on, through the hiring team) or admin (every job, the team and invitations).";
const TEAM_ROLE_HELP =
  "hiring_manager and recruiter manage the job and its pipeline, coordinator and sourcer see its " +
  "candidates, interviewer gives no access beyond their own interviews.";

const LEVELS = { limited: "interviewer", elevated: "hiring team", admin: "admin" } as const;

export function buildClientHandler(member: ClientMember, source: "claude" | "chatgpt", deps: ClientHandlerDeps) {
  const db = member.db;
  const ctx: clientTools.ClientToolCtx = {
    actorId: member.actorId,
    orgId: member.orgId,
    accessLevel: member.accessLevel,
    source,
  };
  const audit = (tool: string, args: unknown, personIds: string[], ok: boolean) =>
    deps.audit({ actorId: member.actorId, tool, args, personIds, ok });
  const inviteDeps: clientTools.InviteDeps = {
    invitations: deps.invitations,
    workosOrgId: member.workosOrgId,
    inviterUserId: member.subject,
  };
  const refuse = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

  /**
   * One tool call: audited either way, reads held to the hourly breadth
   * ceiling, a ClientToolError answered with its sentence, anything else
   * logged and reported without detail.
   */
  async function run(tool: string, kind: "read" | "write", args: unknown, fn: () => Promise<Outcome>) {
    try {
      const out = await fn();
      if (kind === "read" && out.candidateIds.length && (await deps.breadth(member.actorId, out.candidateIds))) {
        await audit(tool, args, out.candidateIds, false);
        return refuse("You have looked at too many different candidates in the last hour. Narrow the request and try again later.");
      }
      await audit(tool, args, out.candidateIds, true);
      return {
        content: [{ type: "text" as const, text: `${out.summary}\n\n${JSON.stringify(out.data)}` }],
        structuredContent: out.data,
      };
    } catch (err) {
      await audit(tool, args, [], false);
      if (err instanceof clientTools.ClientToolError) return refuse(err.message);
      console.error(`[client-mcp] ${tool} failed`, err);
      return refuse("Something went wrong on the Tacit side. Try again.");
    }
  }

  const cardOut = (c: clientTools.JobPipeline["cards"][number]) => ({
    application_id: c.applicationId,
    candidate_id: c.personId,
    candidate: named(c.personName),
    headline: fence("headline", c.headline),
    stage: c.stage,
    source: c.source,
    source_detail: fence("source", c.sourceDetail),
    owner: c.ownerName,
    last_touch_at: c.lastTouchAt,
    next_action: c.nextAction,
    next_action_due: c.nextActionDue,
    needs_attention: c.stalled,
  });
  // A subject is the member's or a template's text, with the candidate's name filled in: fenced.
  const emailOut = (e: clientTools.CandidateEmail) => ({
    email_id: e.emailId, status: e.status, to: e.to, subject: fence("subject", e.subject), by: e.author, yours: e.mine,
    application_id: e.applicationId, template_id: e.templateId, created_at: e.createdAt, sent_at: e.sentAt,
  });
  // A filename is the uploader's text: fenced.
  const fileOut = (f: clientTools.CandidateFile) => ({
    file_id: f.fileId, kind: f.kind, filename: fence("filename", f.filename), content_type: f.contentType,
    size_bytes: f.sizeBytes, uploaded_by: f.uploadedBy, uploaded_at: f.uploadedAt,
  });
  // Field and option names are the company admins' own vocabulary, passed back verbatim:
  // bare, like job titles. Typed text and links are a member's words about a candidate: fenced.
  const customValueOut = (type: string, value: clientTools.CustomFieldValue["value"] | null) =>
    typeof value === "string" && (type === "short_text" || type === "long_text" || type === "url")
      ? fence("custom field", value)
      : value;
  const customFieldOut = (v: clientTools.CustomFieldValue) => ({
    field_id: v.fieldId, field: v.name, type: v.type, private: v.private, value: customValueOut(v.type, v.value),
  });

  const PLACEHOLDER_HELP =
    "Placeholders Tacit fills in: " +
    Object.entries(clientTools.EMAIL_PLACEHOLDERS).map(([k, v]) => `{{${k}}} (${v})`).join(", ") + ".";
  const templateOut = (t: clientTools.EmailTemplate) => ({
    template_id: t.templateId, name: fence("template", t.name), subject: fence("subject", t.subject),
    body: fence("body", t.body), archived: t.archived, updated_at: t.updatedAt,
  });

  return createMcpHandler(
    (server) => {
      server.registerTool(
        "whoami",
        {
          title: "Who am I in Tacit",
          description:
            "Your company's Tacit workspace: the company, your name and access level, and the jobs you " +
            "can see (each with a job_id). Call this first to learn what you can do. An interviewer sees " +
            "only the jobs they interview for, the hiring team the jobs they are on, an admin every job.",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("whoami", "read", args, async () => {
            const [org, me, jobs] = await Promise.all([
              member.db.from("orgs").select("name").eq("id", member.orgId).maybeSingle(),
              member.db.from("org_members").select("display_name, email").eq("id", member.actorId).maybeSingle(),
              member.db.from("roles").select("id, title, status").order("created_at", { ascending: false }).limit(100),
            ]);
            for (const r of [org, me, jobs]) if (r.error) throw new Error(r.error.message);
            const level = LEVELS[member.accessLevel];
            const list = jobs.data ?? [];
            return {
              summary:
                `You are ${me.data?.display_name ?? "a member"} at ${org.data?.name ?? "your company"}, ` +
                `with ${level} access. You can see ${list.length} job${list.length === 1 ? "" : "s"}.`,
              data: {
                company: org.data?.name ?? null,
                you: { user_id: member.actorId, name: me.data?.display_name ?? null, email: me.data?.email ?? null, access: level },
                jobs: list.map((j) => ({ job_id: j.id, title: j.title, status: j.status })),
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "list_jobs",
        {
          title: "List jobs",
          description:
            "Your company's jobs that you can see, newest first, each with a job_id and (for the hiring " +
            "team and admins) how many candidates are in it, its department, its offices and its openings " +
            "(open, filled, closed). status narrows to one status, e.g. open; department (a name or id, " +
            "including the departments inside it) and office (a name or id) narrow it further.",
          inputSchema: z.object({
            status: z.string().max(40).optional(),
            department: z.string().min(1).max(100).optional(),
            office: z.string().min(1).max(100).optional(),
          }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_jobs", "read", args, async () => {
            const jobs = await clientTools.listJobs(db, ctx, { status: args.status, department: args.department, office: args.office });
            return {
              summary: `${jobs.length} job${jobs.length === 1 ? "" : "s"}.`,
              data: {
                jobs: jobs.map((j) => ({
                  job_id: j.jobId, title: j.title, status: j.status, location: j.location, level: j.seniority, candidates: j.inPipeline,
                  custom_fields: j.customFields.map(customFieldOut),
                  department: j.department, offices: j.offices, openings: j.openings,
                })),
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "get_pipeline",
        {
          title: "Get a job's pipeline",
          description:
            `One job's candidates by stage (${STAGE_LIST}), each with application_id and candidate_id, ` +
            "the owner, the next action and whether it needs attention (no contact for a week, or a next " +
            "action past its date). Not available to interviewers.",
          inputSchema: z.object({ job_id: uuid("job_id") }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("get_pipeline", "read", args, async () => {
            const p = await clientTools.getJobPipeline(db, ctx, args.job_id);
            return {
              summary: `${p.title}: ${p.cards.length} candidate${p.cards.length === 1 ? "" : "s"}, ${p.stalledCount} needing attention.`,
              data: {
                job_id: p.jobId, title: p.title, status: p.status, custom_fields: p.customFields.map(customFieldOut),
                candidates: p.cards.map(cardOut),
              },
              candidateIds: p.cards.map((c) => c.personId),
            };
          }),
      );

      server.registerTool(
        "search_candidates",
        {
          title: "Search candidates",
          description:
            "Find candidates you can see by name, email, company or title (query), optionally only those " +
            "in one job (job_id) or carrying one tag (tag: its name or tag_id, from list_tags). Returns " +
            "candidate_id and the jobs each is in, with application_id and stage. An interviewer finds only " +
            "the people they interview.",
          inputSchema: z.object({
            query: z.string().max(200).optional(),
            job_id: uuid("job_id").optional(),
            tag: z.string().min(1).max(100).optional(),
            limit: z.number().int().min(1).max(clientTools.LIST_MAX).optional(),
          }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("search_candidates", "read", args, async () => {
            const hits = await clientTools.searchCandidates(db, ctx, { query: args.query, jobId: args.job_id, tag: args.tag, limit: args.limit });
            return {
              summary: `${hits.length} candidate${hits.length === 1 ? "" : "s"}.`,
              data: {
                candidates: hits.map((h) => ({
                  candidate_id: h.candidateId,
                  name: named(h.name),
                  headline: fence("headline", h.headline),
                  jobs: h.applications.map((a) => ({ application_id: a.applicationId, job_id: a.jobId, job: a.jobTitle, stage: a.stage })),
                })),
              },
              candidateIds: hits.map((h) => h.candidateId),
            };
          }),
      );

      server.registerTool(
        "get_candidate",
        {
          title: "Get a candidate",
          description:
            "One candidate by candidate_id: their profile, their tags, the jobs they are in (application_id, " +
            "stage, how they came in, next action, why they closed, and the latest offer if you manage the " +
            "job), the team's notes, their files (file_id for get_file_link) and the emails sent to them " +
            "(list_emails has the bodies). get_activity has their " +
            "history. An interviewer gets the name, headline and LinkedIn of someone they interview, their " +
            "resume, and their own notes.",
          inputSchema: z.object({ candidate_id: uuid("candidate_id") }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("get_candidate", "read", args, async () => {
            const c = await clientTools.getCandidate(db, ctx, args.candidate_id);
            return {
              summary: `${c.applications.length ? `In ${c.applications.length} job${c.applications.length === 1 ? "" : "s"}` : "In no job you can see"}, ${c.notes.length} note${c.notes.length === 1 ? "" : "s"}.`,
              data: {
                candidate_id: c.candidateId,
                name: named(c.name),
                headline: fence("headline", c.headline),
                email: c.email,
                location: fence("location", c.location),
                linkedin_url: c.linkedinUrl,
                summary: fence("summary", c.summary),
                full_profile: c.full,
                tags: c.tags.map((t) => fence("tag", t)),
                jobs: c.applications.map((a) => ({
                  application_id: a.applicationId, job_id: a.jobId, job: a.jobTitle, stage: a.stage,
                  source: a.source, source_detail: fence("source", a.sourceDetail),
                  next_action: a.nextAction, next_action_due: a.nextActionDue, last_touch_at: a.lastTouchAt,
                  rejection_reason: a.rejectionReason, rejection_note: fence("note", a.rejectionNote),
                  offer: a.offer ? { offer_id: a.offer.offerId, status: a.offer.status } : null,
                })),
                notes: c.notes.map((n) => ({ note_id: n.noteId, text: fence("note", n.text), author: n.author, created_at: n.createdAt, yours: n.mine })),
                files: c.files.map(fileOut),
                custom_fields: c.customFields.map(customFieldOut),
                emails: c.emails.map(emailOut),
              },
              candidateIds: [c.candidateId],
            };
          }),
      );

      server.registerTool(
        "list_team",
        {
          title: "List your team",
          description: "The people in your company's Tacit workspace, with their user_id and access level.",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_team", "read", args, async () => {
            const team = await clientTools.listTeam(db);
            return {
              summary: `${team.length} ${team.length === 1 ? "person" : "people"}.`,
              data: {
                team: team.map((m) => ({
                  user_id: m.userId, name: m.name, email: m.email,
                  access: m.access && m.access in LEVELS ? LEVELS[m.access as keyof typeof LEVELS] : m.access,
                })),
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "add_candidate",
        {
          title: "Add a candidate to a job",
          description:
            "Adds someone to a job's pipeline at sourced. With an email, someone already in your " +
            "company's records under it is reused rather than duplicated; someone already in the job is " +
            `left where they are. source is how they came in (${SOURCE_LIST}; sourced if not said) and ` +
            "source_detail which referrer, agency, board or event. Needs hiring-team access to the job.",
          inputSchema: z.object({
            job_id: uuid("job_id"),
            name: z.string().min(1).max(200),
            email: z.string().max(320).optional(),
            linkedin_url: z.string().max(500).optional(),
            source: z.enum(CANDIDATE_SOURCES).optional(),
            source_detail: z.string().max(SOURCE_DETAIL_MAX).optional(),
          }),
        },
        (args) =>
          run("add_candidate", "write", { ...args, source_detail: undefined }, async () => {
            const r = await clientTools.addCandidate(db, ctx, {
              jobId: args.job_id, name: args.name, email: args.email, linkedinUrl: args.linkedin_url,
              source: args.source, sourceDetail: args.source_detail,
            });
            return {
              summary: r.outcome === "added"
                ? `Added to the job at ${r.stage}${r.newCandidate ? "" : ", reusing the candidate already on file"}.`
                : `Already in this job, at ${r.stage}. Nothing changed.`,
              data: { outcome: r.outcome, application_id: r.applicationId, candidate_id: r.candidateId, new_candidate: r.newCandidate, stage: r.stage },
              candidateIds: [r.candidateId],
            };
          }),
      );

      server.registerTool(
        "update_stage",
        {
          title: "Move a candidate to another stage",
          description:
            `Moves one application (application_id) to another stage: ${STAGE_LIST}. Pass expected_stage, ` +
            "the stage you last saw: if someone moved them since, nothing changes and you get the current " +
            "stage back. Moving to rejected or withdrawn needs rejection_reason_id (from " +
            "list_rejection_reasons, of the matching kind) and takes an optional rejection_note; calling it " +
            "again on someone already there replaces the reason. Tell the user what will change and wait " +
            "for a yes before calling this.",
          inputSchema: z.object({
            application_id: uuid("application_id"),
            stage: z.enum(APPLICATION_STAGES),
            expected_stage: z.enum(APPLICATION_STAGES).optional(),
            rejection_reason_id: uuid("rejection_reason_id").optional(),
            rejection_note: z.string().max(2000).optional(),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("update_stage", "write", { ...args, rejection_note: undefined }, async () => {
            const r = await clientTools.updateStage(db, ctx, {
              applicationId: args.application_id, stage: args.stage, expectedStage: args.expected_stage,
              reasonId: args.rejection_reason_id, note: args.rejection_note,
            });
            const summary = {
              moved: `Moved to ${r.stage}${r.reason ? ` (${r.reason})` : ""}.`,
              unchanged: `Already at ${r.stage}. Nothing changed.`,
              changed_since: `Not moved: someone changed it since; it is at ${r.stage} now. Ask the user again.`,
              reason_set: `Still ${r.stage}; the reason is now ${r.reason}.`,
            }[r.outcome];
            const o = r.opening;
            const hire = !o ? "" : ` That filled opening ${o.code ?? `#${o.number}`}; ` + (o.openLeft
              ? `${o.openLeft} still open.`
              : `none is left open${o.jobStatus === "filled" ? ", so the job is now filled" : ""}.`);
            return {
              summary: summary + hire,
              data: {
                outcome: r.outcome, application_id: args.application_id, stage: r.stage, rejection_reason: r.reason,
                // Only on a move to hired.
                ...(r.opening !== undefined
                  ? { opening: o ? { opening_id: o.openingId, number: o.number, code: o.code, open_left: o.openLeft, job_status: o.jobStatus } : null }
                  : {}),
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "set_next_action",
        {
          title: "Set a candidate's next action",
          description:
            "Sets or clears (next_action: null) what happens next for one application, with an optional " +
            "due date (YYYY-MM-DD). Replaces the one there.",
          inputSchema: z.object({
            application_id: uuid("application_id"),
            next_action: z.string().max(500).nullable(),
            due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional(),
          }),
        },
        (args) =>
          run("set_next_action", "write", args, async () => {
            const r = await clientTools.setApplicationNextAction(db, ctx, {
              applicationId: args.application_id, nextAction: args.next_action, due: args.due,
            });
            const summary = { set: "Next action set.", cleared: "Next action cleared.", unchanged: "Already that. Nothing changed." }[r.outcome];
            return {
              summary,
              data: { outcome: r.outcome, application_id: args.application_id, next_action: r.nextAction, due: r.due },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "add_note",
        {
          title: "Add a note on a candidate",
          description:
            "Adds a note on a candidate (candidate_id) that your team can read. An interviewer can note " +
            "the people they interview. Notes cannot be edited or deleted here.",
          inputSchema: z.object({ candidate_id: uuid("candidate_id"), text: z.string().min(1).max(clientTools.NOTE_MAX) }),
        },
        (args) =>
          run("add_note", "write", { candidate_id: args.candidate_id }, async () => {
            const r = await clientTools.addNote(db, ctx, { candidateId: args.candidate_id, text: args.text });
            return { summary: "Note added.", data: { note_id: r.noteId, candidate_id: args.candidate_id }, candidateIds: [args.candidate_id] };
          }),
      );

      server.registerTool(
        "create_job",
        {
          title: "Create a job",
          description:
            "Creates a job at your company (admins only), open unless status says otherwise. Returns its " +
            "job_id; add the people who work it with add_to_hiring_team. department is a name or id from " +
            "list_departments, offices names or ids from list_offices. openings is how many people it hires " +
            "(1 unless said; add_openings adds more later). Confirm the details with the user first.",
          inputSchema: z.object({
            title: z.string().min(1).max(200),
            status: z.enum(clientTools.JOB_STATUSES).optional(),
            location: z.string().max(200).optional(),
            level: z.string().max(200).optional(),
            description: z.string().max(20_000).optional(),
            department: z.string().min(1).max(100).optional(),
            offices: z.array(z.string().min(1).max(100)).max(20).optional(),
            openings: z.number().int().min(0).max(clientTools.OPENINGS_ADD_MAX).optional(),
          }),
        },
        (args) =>
          run("create_job", "write", { title: args.title, status: args.status, openings: args.openings }, async () => {
            const r = await clientTools.createJob(db, ctx, {
              title: args.title, status: args.status, location: args.location, seniority: args.level, description: args.description,
              department: args.department, offices: args.offices, openings: args.openings,
            });
            return {
              summary: `Created "${r.title}", ${r.status}, with ${r.openings} opening${r.openings === 1 ? "" : "s"}.`,
              data: {
                job_id: r.jobId, title: r.title, status: r.status, department: r.department, offices: r.offices, openings: r.openings,
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "update_job",
        {
          title: "Update a job",
          description:
            `Changes a job's title, status (${clientTools.JOB_STATUSES.join(", ")}), location, level, ` +
            "description, department (a name or id, null for none) or offices (names or ids: the job's " +
            "whole set, [] for none). Only what you pass changes. Needs the right to manage that job. When the job has " +
            "a job_open approval flow, it opens only once its opening is approved (request_approval with " +
            "job_id). Tell the user what will change and wait for a yes.",
          inputSchema: z.object({
            job_id: uuid("job_id"),
            title: z.string().min(1).max(200).optional(),
            status: z.enum(clientTools.JOB_STATUSES).optional(),
            location: z.string().max(200).nullable().optional(),
            level: z.string().max(200).nullable().optional(),
            description: z.string().max(20_000).nullable().optional(),
            department: z.string().min(1).max(100).nullable().optional(),
            offices: z.array(z.string().min(1).max(100)).max(20).optional(),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("update_job", "write", { job_id: args.job_id, status: args.status }, async () => {
            const r = await clientTools.updateJob(db, ctx, {
              jobId: args.job_id, title: args.title, status: args.status,
              location: args.location, seniority: args.level, description: args.description,
              department: args.department, offices: args.offices,
            });
            const changed = r.changed.map((c) => (c === "seniority" ? "level" : c));
            return {
              summary: r.outcome === "updated" ? `Updated ${changed.join(", ")}.` : "Nothing to change.",
              data: { outcome: r.outcome, job_id: args.job_id, changed },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "get_hiring_team",
        {
          title: "Get a job's hiring team",
          description:
            "Who works a job: each person's user_id, their team roles on it, and the access that gives them " +
            `(${TEAM_ROLE_HELP})`,
          inputSchema: z.object({ job_id: uuid("job_id") }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("get_hiring_team", "read", args, async () => {
            const t = await clientTools.getHiringTeam(db, ctx, args.job_id);
            return {
              summary: `${t.title}: ${t.team.length} ${t.team.length === 1 ? "person" : "people"} on the hiring team.`,
              data: {
                job_id: t.jobId,
                title: t.title,
                team: t.team.map((m) => ({
                  user_id: m.userId, name: m.name, team_roles: m.teamRoles, job_access: m.access, set_by_hand: m.accessSetByHand,
                })),
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "add_to_hiring_team",
        {
          title: "Add someone to a hiring team",
          description:
            `Puts a member of your company (user_id from list_team) on a job's hiring team as team_role. ${TEAM_ROLE_HELP} ` +
            "Someone at interviewer access who gains a managing role becomes hiring team. Admins only.",
          inputSchema: z.object({
            job_id: uuid("job_id"),
            user_id: uuid("user_id"),
            team_role: z.enum(clientTools.TEAM_ROLES),
          }),
        },
        (args) =>
          run("add_to_hiring_team", "write", args, async () => {
            const r = await clientTools.addToHiringTeam(db, ctx, { jobId: args.job_id, userId: args.user_id, teamRole: args.team_role });
            return {
              summary: r.outcome === "added" ? `Added as ${args.team_role}.` : `Already ${args.team_role} on this job. Nothing changed.`,
              data: { outcome: r.outcome, job_id: args.job_id, user_id: args.user_id, team_role: args.team_role },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "remove_from_hiring_team",
        {
          title: "Remove someone from a hiring team",
          description:
            "Takes a member off a job's hiring team: one team_role, or every role they hold on it when " +
            "team_role is left out. Access the team gave them goes with it. Admins only. Confirm with the user first.",
          inputSchema: z.object({
            job_id: uuid("job_id"),
            user_id: uuid("user_id"),
            team_role: z.enum(clientTools.TEAM_ROLES).optional(),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("remove_from_hiring_team", "write", args, async () => {
            const r = await clientTools.removeFromHiringTeam(db, ctx, { jobId: args.job_id, userId: args.user_id, teamRole: args.team_role });
            return {
              summary: r.outcome === "removed" ? `Removed (${r.removed.join(", ")}).` : "They were not on this job's team in that role. Nothing changed.",
              data: { outcome: r.outcome, job_id: args.job_id, user_id: args.user_id, removed: r.removed },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "set_member_access",
        {
          title: "Change someone's access",
          description:
            `Sets a member's access at your company (user_id from list_team). ${ACCESS_HELP} Admins only; ` +
            "the company always keeps at least one admin. Tell the user exactly what will change and wait for a yes.",
          inputSchema: z.object({ user_id: uuid("user_id"), access: z.enum(["interviewer", "hiring team", "admin"]) }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("set_member_access", "write", args, async () => {
            const r = await clientTools.setMemberAccess(db, ctx, { userId: args.user_id, access: ACCESS[args.access] });
            const previous = LEVELS[r.previous];
            return {
              summary: r.outcome === "changed" ? `Changed from ${previous} to ${args.access}.` : `Already ${args.access}. Nothing changed.`,
              data: { outcome: r.outcome, user_id: args.user_id, previous, access: args.access },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "invite_member",
        {
          title: "Invite someone to your company's workspace",
          description:
            `Invites a colleague by email: they get an email from WorkOS to join. ${ACCESS_HELP} Inviting an ` +
            "address already invited sends the email again. Admins only. Confirm the address with the user first.",
          inputSchema: z.object({
            email: z.string().min(3).max(320),
            name: z.string().min(1).max(120),
            access: z.enum(["interviewer", "hiring team", "admin"]),
          }),
        },
        (args) =>
          run("invite_member", "write", { access: args.access }, async () => {
            const r = await clientTools.inviteMember(db, ctx, inviteDeps, { email: args.email, name: args.name, access: ACCESS[args.access] });
            return {
              summary: r.outcome === "resent" ? "Already invited: the invitation was sent again." : "Invited. They will get an email to join.",
              data: { outcome: r.outcome, user_id: r.userId, email: args.email.trim().toLowerCase(), access: args.access },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "list_invites",
        {
          title: "List pending invitations",
          description: "Who has been invited and has not signed in yet, with their user_id for withdraw_invite. Admins only.",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_invites", "read", args, async () => {
            const pending = await clientTools.listInvites(db, ctx);
            return {
              summary: `${pending.length} pending invitation${pending.length === 1 ? "" : "s"}.`,
              data: {
                invites: pending.map((p) => ({
                  user_id: p.actorId, name: p.displayName, email: p.email, access: LEVELS[p.accessLevel], invited_at: p.invitedAt,
                })),
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "withdraw_invite",
        {
          title: "Withdraw an invitation",
          description: "Takes back an invitation nobody has accepted (user_id from list_invites). Admins only.",
          inputSchema: z.object({ user_id: uuid("user_id") }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("withdraw_invite", "write", args, async () => {
            const r = await clientTools.withdrawInvite(db, ctx, inviteDeps, { userId: args.user_id });
            return {
              summary: r.outcome === "withdrawn" ? "Invitation withdrawn." : "No pending invitation with that user id. Nothing changed.",
              data: { outcome: r.outcome, user_id: args.user_id },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "list_my_interviews",
        {
          title: "List my interviews",
          description:
            "The interviews you are an interviewer on: when, where, which candidate and job, and whether " +
            "you have filed your feedback (each with an interview_id for submit_feedback). when is " +
            "upcoming (default), past or all.",
          inputSchema: z.object({ when: z.enum(["upcoming", "past", "all"]).optional() }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_my_interviews", "read", args, async () => {
            const list = await clientTools.listMyInterviews(db, ctx, { when: args.when });
            const pending = list.filter((i) => !i.feedbackFiled && i.status !== "cancelled" && Date.parse(i.startsAt) <= Date.now()).length;
            return {
              summary: `${list.length} interview${list.length === 1 ? "" : "s"}${pending ? `, ${pending} waiting on your feedback` : ""}.`,
              data: {
                interviews: list.map((i) => ({
                  interview_id: i.interviewId, application_id: i.applicationId, candidate_id: i.candidateId,
                  candidate: named(i.candidateName), job_id: i.jobId, job: i.jobTitle,
                  starts_at: i.startsAt, ends_at: i.endsAt, status: i.status, step: i.step,
                  location_or_link: i.locationOrLink, your_feedback_filed: i.feedbackFiled,
                })),
              },
              candidateIds: [...new Set(list.map((i) => i.candidateId))],
            };
          }),
      );

      server.registerTool(
        "schedule_interview",
        {
          title: "Schedule an interview",
          description:
            "Records an interview on one application (application_id) with your company's interviewers " +
            "(user_ids from list_team). Times are ISO 8601 with their offset. This only records it in " +
            "Tacit: no calendar invite is sent to anyone, the candidate included. When the job has an " +
            "interview plan, step must be one of its steps (get_interview_plan); without one, any step " +
            "name goes. Needs the right to schedule on that job. Confirm the time and interviewers with " +
            "the user first.",
          inputSchema: z.object({
            application_id: uuid("application_id"),
            starts_at: z.string().max(40),
            ends_at: z.string().max(40),
            interviewer_user_ids: z.array(uuid("each interviewer")).min(1).max(10),
            location_or_link: z.string().max(500).optional(),
            step: z.string().max(120).optional(),
          }),
        },
        (args) =>
          run("schedule_interview", "write", args, async () => {
            const r = await clientTools.scheduleInterview(db, ctx, {
              applicationId: args.application_id, startsAt: args.starts_at, endsAt: args.ends_at,
              interviewerIds: args.interviewer_user_ids, locationOrLink: args.location_or_link, step: args.step,
            });
            return {
              summary: "Interview recorded. Nobody was sent an invitation.",
              data: { interview_id: r.interviewId, application_id: args.application_id },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "update_interview",
        {
          title: "Change or cancel an interview",
          description:
            `Moves an interview, changes its interviewers or location, or sets its status (${clientTools.INTERVIEW_STATUSES.join(", ")}). ` +
            "Only what you pass changes. Needs the right to schedule on that job. Tell the user what will " +
            "change and wait for a yes.",
          inputSchema: z.object({
            interview_id: uuid("interview_id"),
            starts_at: z.string().max(40).optional(),
            ends_at: z.string().max(40).optional(),
            interviewer_user_ids: z.array(uuid("each interviewer")).min(1).max(10).optional(),
            location_or_link: z.string().max(500).nullable().optional(),
            status: z.enum(clientTools.INTERVIEW_STATUSES).optional(),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("update_interview", "write", args, async () => {
            const r = await clientTools.updateInterview(db, ctx, {
              interviewId: args.interview_id, startsAt: args.starts_at, endsAt: args.ends_at,
              interviewerIds: args.interviewer_user_ids, locationOrLink: args.location_or_link, status: args.status,
            });
            return {
              summary: r.outcome === "updated" ? `Updated ${r.changed.join(", ")}.` : "Nothing to change.",
              data: { outcome: r.outcome, interview_id: args.interview_id, changed: r.changed },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "submit_feedback",
        {
          title: "Submit interview feedback",
          description:
            `Files your feedback on an interview you were an interviewer on, once it has started: a ` +
            `recommendation (${clientTools.RECOMMENDATIONS.join(", ")}), an optional rating from 1 to 4, ` +
            "notes, and optionally a 1-4 rating with a short note for each attribute on the job's " +
            "scorecard (attribute_ids from get_scorecard). Filing again replaces yours, ratings included. " +
            "Feedback is private to your company's hiring team: never put it in a message to the candidate.",
          inputSchema: z.object({
            interview_id: uuid("interview_id"),
            recommendation: z.enum(clientTools.RECOMMENDATIONS),
            rating: z.number().int().min(1).max(4).optional(),
            notes: z.string().min(1).max(10_000),
            ratings: z.array(z.object({
              attribute_id: uuid("attribute_id"),
              rating: z.number().int().min(1).max(4),
              note: z.string().max(500).optional(),
            })).max(25).optional(),
          }),
        },
        (args) =>
          run("submit_feedback", "write", {
            interview_id: args.interview_id, recommendation: args.recommendation, ratings: args.ratings?.length ?? 0,
          }, async () => {
            const r = await clientTools.submitFeedback(db, ctx, {
              interviewId: args.interview_id, recommendation: args.recommendation, rating: args.rating, notes: args.notes,
              ratings: args.ratings?.map((x) => ({ attributeId: x.attribute_id, rating: x.rating, note: x.note })),
            });
            return {
              summary: (r.replaced ? "Your feedback was replaced." : "Feedback filed.") +
                (r.ratings ? ` ${r.ratings} scorecard rating${r.ratings === 1 ? "" : "s"}.` : ""),
              data: { feedback_id: r.feedbackId, interview_id: args.interview_id, replaced: r.replaced, ratings: r.ratings },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "get_feedback",
        {
          title: "Read interview feedback",
          description:
            "The feedback filed on one interview (interview_id) or every interview of one application " +
            "(application_id), with each interview's interviewers and each feedback's scorecard ratings. " +
            "Whose feedback you can read follows " +
            "your company's setting: often only after you have filed your own. Private to the hiring " +
            "team: never put it in a message to the candidate.",
          inputSchema: z.object({ interview_id: uuid("interview_id").optional(), application_id: uuid("application_id").optional() }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("get_feedback", "read", args, async () => {
            const f = await clientTools.getFeedback(db, ctx, { interviewId: args.interview_id, applicationId: args.application_id });
            return {
              summary:
                `${f.feedback.length} piece${f.feedback.length === 1 ? "" : "s"} of feedback across ${f.interviews.length} interview${f.interviews.length === 1 ? "" : "s"}.` +
                (f.yoursOutstanding ? " Yours is still outstanding, so others' may be hidden until you file it." : ""),
              data: {
                private: true,
                interviews: f.interviews.map((i) => ({
                  interview_id: i.interviewId, starts_at: i.startsAt, status: i.status, step: i.step,
                  interviewers: i.interviewers.map((p) => ({ user_id: p.userId, name: p.name })),
                })),
                feedback: f.feedback.map((e) => ({
                  feedback_id: e.feedbackId, interview_id: e.interviewId, interviewer_id: e.interviewerId, interviewer: e.interviewer,
                  recommendation: e.recommendation, rating: e.rating, notes: fence("feedback", e.notes),
                  ratings: e.ratings.map((x) => ({
                    attribute_id: x.attributeId, attribute: x.attribute, rating: x.rating, note: fence("feedback", x.note),
                  })),
                  submitted_at: e.submittedAt, yours: e.mine,
                })),
                yours_outstanding: f.yoursOutstanding,
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "list_rejection_reasons",
        {
          title: "List rejection reasons",
          description:
            "Your company's reasons an application can close, each with a rejection_reason_id for " +
            "update_stage. kind rejected is for a candidate the company passed on (stage rejected), " +
            "withdrew for one who pulled out (stage withdrawn).",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_rejection_reasons", "read", args, async () => {
            const reasons = await clientTools.listRejectionReasons(db, ctx);
            return {
              summary: `${reasons.length} reason${reasons.length === 1 ? "" : "s"}.`,
              data: { reasons: reasons.map((r) => ({ rejection_reason_id: r.reasonId, kind: r.kind, name: r.name })) },
              candidateIds: [],
            };
          }),
      );

      // An approver's reason is their own words: fenced like a note.
      const decisionOut = (d: clientTools.ApprovalDecision) => ({
        step: d.step, decision: d.decision, by: d.by, at: d.at, reason: fence("reason", d.reason),
      });
      const offerOut = (o: clientTools.Offer) => ({
        offer_id: o.offerId, application_id: o.applicationId, status: o.status,
        salary: o.salary, currency: o.currency, bonus: o.bonus, equity: o.equity,
        start_date: o.startDate, expires_on: o.expiresOn, notes: fence("note", o.notes),
        created_by: o.createdBy, created_at: o.createdAt, extended_at: o.extendedAt, resolved_at: o.resolvedAt,
        approval: o.approval
          ? {
              required: o.approval.required, status: o.approval.status, request_id: o.approval.requestId,
              waiting_step: o.approval.waitingStep, steps: o.approval.steps, requested_by: o.approval.requestedBy,
              requested_at: o.approval.requestedAt, decisions: o.approval.decisions.map(decisionOut),
            }
          : null,
        custom_fields: o.customFields.map(customFieldOut),
      });
      const OFFER_TERMS = {
        salary: z.number().int().min(0).max(100_000_000).nullable().optional(),
        currency: z.string().length(3).optional(),
        bonus: z.string().max(500).nullable().optional(),
        equity: z.string().max(500).nullable().optional(),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").nullable().optional(),
        expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").nullable().optional(),
        notes: z.string().max(5000).nullable().optional(),
      };
      const termsIn = (a: { salary?: number | null; currency?: string; bonus?: string | null; equity?: string | null;
        start_date?: string | null; expires_on?: string | null; notes?: string | null }) => ({
        salary: a.salary, currency: a.currency, bonus: a.bonus, equity: a.equity,
        startDate: a.start_date, expiresOn: a.expires_on, notes: a.notes,
      });

      server.registerTool(
        "get_offers",
        {
          title: "Get a candidate's offers",
          description:
            "Every offer on one application (application_id), newest first: status, salary (a whole " +
            "amount a year), currency, bonus, equity, start date, expiry, who drafted it and when it was " +
            "extended or closed, and its approval when the job has an offer approval flow (required, " +
            "status, the step it waits on, each decision). Only for the people who manage the job. " +
            "Compensation is confidential: share it only with the user.",
          inputSchema: z.object({ application_id: uuid("application_id") }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("get_offers", "read", args, async () => {
            const offers = await clientTools.getOffers(db, ctx, { applicationId: args.application_id });
            const open = offers.find((o) => o.status === "draft" || o.status === "extended");
            return {
              summary: `${offers.length} offer${offers.length === 1 ? "" : "s"}${open ? `, one ${open.status}` : ""}.`,
              data: { application_id: args.application_id, offers: offers.map(offerOut) },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "create_offer",
        {
          title: "Draft an offer",
          description:
            "Drafts an offer on one application with its terms: salary (a whole amount a year), currency " +
            "(three letters, USD by default), bonus, equity, start_date and expires_on (YYYY-MM-DD), notes. " +
            "It starts as a draft; update_offer extends it once the user says it went out. One open offer " +
            "per application. Only for the people who manage the job. This does not move the candidate's " +
            "stage or send anything. Confirm the terms with the user first.",
          inputSchema: z.object({ application_id: uuid("application_id"), ...OFFER_TERMS }),
        },
        (args) =>
          run("create_offer", "write", { application_id: args.application_id }, async () => {
            const r = await clientTools.createOffer(db, ctx, { applicationId: args.application_id, ...termsIn(args) });
            return {
              summary: "Offer drafted. Nothing was sent to the candidate.",
              data: { offer_id: r.offerId, application_id: args.application_id, status: "draft" },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "update_offer",
        {
          title: "Change an offer or record its outcome",
          description:
            `Changes a draft offer's terms, or moves an offer along: a draft becomes extended (it went to ` +
            "the candidate) or withdrawn; an extended one becomes accepted, declined or withdrawn. An " +
            "extended offer's terms never change: withdraw it and draft a new one. A closed offer never " +
            "changes. Notes can change while it is open. Only what you pass changes. Recording accepted " +
            "does not mark them hired: move their stage with update_stage. When the job has an offer " +
            "approval flow, a draft is extended only once request_approval's request is approved, with " +
            "the approved terms; changing a draft's terms resets its approval. Tell the user what will " +
            "change and wait for a yes.",
          inputSchema: z.object({
            offer_id: uuid("offer_id"),
            status: z.enum(clientTools.OFFER_STATUSES).optional(),
            ...OFFER_TERMS,
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("update_offer", "write", { offer_id: args.offer_id, status: args.status }, async () => {
            const r = await clientTools.updateOffer(db, ctx, { offerId: args.offer_id, status: args.status, ...termsIn(args) });
            const summary = {
              updated: `Offer updated (${r.changed.join(", ")}); it is ${r.status}.`,
              unchanged: `Nothing to change; it is ${r.status}.`,
              changed_since: `Not changed: someone changed the offer since; it is ${r.status}. Ask the user again.`,
            }[r.outcome];
            return { summary, data: { outcome: r.outcome, offer_id: args.offer_id, status: r.status, changed: r.changed }, candidateIds: [] };
          }),
      );

      // Step names are the company's own labels for its process, passed back verbatim to
      // schedule_interview: bare, like job titles.
      const planInterviewOut = (i: clientTools.PlanInterview) => ({
        interview_id: i.interviewId, step: i.step, starts_at: i.startsAt, ends_at: i.endsAt, status: i.status,
        interviewers: i.interviewers.map((p) => ({ user_id: p.userId, name: p.name, feedback: p.feedback })),
      });

      server.registerTool(
        "get_interview_plan",
        {
          title: "Get a job's interview plan",
          description:
            "A job's interview plan (job_id): its interview steps in order, e.g. Recruiter screen, " +
            "Technical, Onsite. With application_id, that candidate's progress on each step: its " +
            "interviews and their status (scheduled, done, cancelled), and for each interviewer whether " +
            "their feedback is filed, not filed, or hidden by your company's feedback setting; plus " +
            "interviews on no step or on a step since removed from the plan, and the next step to " +
            "schedule. An interviewer sees only their own interviews. Feedback itself is in get_feedback.",
          inputSchema: z.object({ job_id: uuid("job_id"), application_id: uuid("application_id").optional() }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("get_interview_plan", "read", args, async () => {
            const plan = await clientTools.getInterviewPlan(db, ctx, { jobId: args.job_id, applicationId: args.application_id });
            const c = plan.candidate;
            const done = c ? c.steps.filter((s) => s.state === "done").length : 0;
            const summary =
              (plan.steps.length
                ? `${plan.title} has ${plan.steps.length} interview step${plan.steps.length === 1 ? "" : "s"}.`
                : `${plan.title} has no interview plan yet: any step name is accepted.`) +
              (c && plan.steps.length && c.seesAllInterviews
                ? ` The candidate has done ${done} of them${c.nextStep ? `; next is ${c.nextStep}` : ""}.`
                : "") +
              (c && !c.seesAllInterviews ? " You see only your own interviews with this candidate." : "") +
              (c?.offPlan.length ? ` ${c.offPlan.length} interview${c.offPlan.length === 1 ? " is" : "s are"} off the plan.` : "");
            return {
              summary,
              data: {
                job_id: plan.jobId,
                job: plan.title,
                steps: plan.steps.map((step, n) => ({ position: n + 1, step })),
                ...(c
                  ? {
                      candidate: {
                        application_id: c.applicationId,
                        sees_all_interviews: c.seesAllInterviews,
                        steps: c.steps.map((s) => ({ position: s.position, step: s.step, state: s.state, interviews: s.interviews.map(planInterviewOut) })),
                        off_plan: c.offPlan.map(planInterviewOut),
                        next_step: c.nextStep,
                      },
                    }
                  : {}),
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "set_interview_plan",
        {
          title: "Set a job's interview plan",
          description:
            `Replaces a job's whole interview plan with the steps you pass, in order (at most ` +
            `${clientTools.PLAN_STEPS_MAX}, each a distinct name of up to ${clientTools.STEP_NAME_MAX} characters). ` +
            "[] clears it. Once a job has a plan, schedule_interview takes only its steps. Interviews " +
            "already on a step you remove keep that step's name and show as off the plan; the result " +
            "says how many. Needs the right to manage the job. Tell the user the new steps and wait for a yes.",
          inputSchema: z.object({
            job_id: uuid("job_id"),
            steps: z.array(z.string().max(clientTools.STEP_NAME_MAX)).max(clientTools.PLAN_STEPS_MAX),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("set_interview_plan", "write", args, async () => {
            const r = await clientTools.setInterviewPlan(db, ctx, { jobId: args.job_id, steps: args.steps });
            const kept = r.keptOnInterviews.reduce((n, k) => n + k.interviews, 0);
            const summary =
              (r.outcome === "updated"
                ? r.steps.length ? `The plan is now: ${r.steps.join(", ")}.` : "The plan is cleared: any step name is accepted."
                : "That is already the plan. Nothing changed.") +
              (kept
                ? ` ${kept} interview${kept === 1 ? "" : "s"} still name${kept === 1 ? "s" : ""} a removed step ` +
                  `(${r.keptOnInterviews.map((k) => k.step).join(", ")}) and keep${kept === 1 ? "s" : ""} it, shown off the plan.`
                : "");
            return {
              summary,
              data: {
                outcome: r.outcome,
                job_id: args.job_id,
                steps: r.steps,
                removed: r.removed,
                interviews_keeping_removed_steps: r.keptOnInterviews.map((k) => ({ step: k.step, interviews: k.interviews, scheduled: k.scheduled })),
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "list_files",
        {
          title: "List a candidate's files",
          description:
            "A candidate's resumes and attachments (candidate_id), newest first, each with a file_id for " +
            "get_file_link, its kind, filename, type, size, who added it and when. An interviewer sees only " +
            "the resume of someone they interview.",
          inputSchema: z.object({ candidate_id: uuid("candidate_id") }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_files", "read", args, async () => {
            const files = await clientTools.listFiles(db, ctx, { candidateId: args.candidate_id });
            return {
              summary: `${files.length} file${files.length === 1 ? "" : "s"}.`,
              data: { candidate_id: args.candidate_id, files: files.map(fileOut) },
              candidateIds: [args.candidate_id],
            };
          }),
      );

      server.registerTool(
        "get_file_link",
        {
          title: "Get a link to a file",
          description:
            `A download link for one file (file_id, from list_files or get_candidate). The link expires ` +
            `${clientTools.FILE_LINK_SECONDS / 60} minutes after this call: give it to the user to open now, ` +
            "and call this again for a fresh one rather than saving it. Anyone holding the link can download " +
            "the file until then, so share it only with the user.",
          inputSchema: z.object({ file_id: uuid("file_id") }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("get_file_link", "read", args, async () => {
            const f = await clientTools.getFileLink(db, ctx, deps.files, { fileId: args.file_id });
            return {
              summary: `A link to the ${f.kind}, valid until ${f.expiresAt}.`,
              data: {
                file_id: f.fileId, candidate_id: f.candidateId, kind: f.kind, filename: fence("filename", f.filename),
                url: f.url, expires_at: f.expiresAt,
              },
              candidateIds: [f.candidateId],
            };
          }),
      );

      server.registerTool(
        "add_file",
        {
          title: "Add a resume or attachment",
          description:
            "Attaches a file to a candidate (candidate_id): kind resume or attachment, the filename (letters, " +
            "digits, spaces and . _ - ( ) & , + ' with the type's extension), content_type (application/pdf, " +
            "application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, " +
            `text/plain, image/png or image/jpeg) and the bytes as standard base64 (content_base64), at most ` +
            `${clientTools.FILE_MAX_BYTES / (1024 * 1024)} MB. For whoever can edit the candidate (their hiring ` +
            "team or an admin), not interviewers. Files cannot be replaced or deleted here.",
          inputSchema: z.object({
            candidate_id: uuid("candidate_id"),
            kind: z.enum(clientTools.FILE_KINDS),
            filename: z.string().min(1).max(200),
            content_type: z.string().min(1).max(100),
            content_base64: z.string().min(1).max(clientTools.FILE_BASE64_MAX),
          }),
        },
        (args) =>
          // The bytes and the filename stay out of the call log.
          run("add_file", "write", { candidate_id: args.candidate_id, kind: args.kind, content_type: args.content_type }, async () => {
            const r = await clientTools.addFile(db, ctx, deps.files, {
              candidateId: args.candidate_id, kind: args.kind, filename: args.filename,
              contentType: args.content_type, contentBase64: args.content_base64,
            });
            return {
              summary: `Added the ${r.kind} (${Math.max(1, Math.round(r.sizeBytes / 1024))} KB).`,
              data: {
                file_id: r.fileId, candidate_id: args.candidate_id, kind: r.kind,
                filename: fence("filename", r.filename), size_bytes: r.sizeBytes,
              },
              candidateIds: [args.candidate_id],
            };
          }),
      );

      // Attribute names are bare, like job titles; their descriptions are member-written prose and fenced.
      const attributeOut = (a: clientTools.ScorecardAttribute) => ({
        attribute_id: a.attributeId, name: a.name, description: fence("description", a.description), position: a.position,
        archived: a.archived,
      });

      server.registerTool(
        "get_scorecard",
        {
          title: "Get a job's scorecard",
          description:
            "The attributes interviewers rate candidates on for one job (job_id), in order, each with an " +
            "attribute_id for submit_feedback's ratings. Anyone who can see the job can read it, an " +
            "interviewer included. include_archived adds attributes taken off the scorecard, which old " +
            "ratings still name.",
          inputSchema: z.object({ job_id: uuid("job_id"), include_archived: z.boolean().optional() }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("get_scorecard", "read", args, async () => {
            const s = await clientTools.getScorecard(db, ctx, { jobId: args.job_id, includeArchived: args.include_archived });
            return {
              summary: s.attributes.length
                ? `${s.attributes.length} attribute${s.attributes.length === 1 ? "" : "s"} on the ${s.jobTitle} scorecard.`
                : `The ${s.jobTitle} job has no scorecard yet.`,
              data: { job_id: s.jobId, job: s.jobTitle, attributes: s.attributes.map(attributeOut) },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "set_scorecard",
        {
          title: "Set a job's scorecard",
          description:
            "Sets the attributes interviewers rate on one job to exactly this list, in this order. An " +
            "entry is matched to an existing attribute by name (any case), which also brings back one " +
            "taken off earlier; give attribute_id to rename one; anything new is added. An attribute left " +
            "out is archived, never deleted, so ratings already filed keep it. The same list twice changes " +
            "nothing. Only for the people who manage the job. Tell the user what will change and wait for " +
            "a yes.",
          inputSchema: z.object({
            job_id: uuid("job_id"),
            attributes: z.array(z.object({
              attribute_id: uuid("attribute_id").optional(),
              name: z.string().min(1).max(120),
              description: z.string().max(1000).nullable().optional(),
            })).max(25),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("set_scorecard", "write", { job_id: args.job_id, attributes: args.attributes.length }, async () => {
            const r = await clientTools.setScorecard(db, ctx, {
              jobId: args.job_id,
              attributes: args.attributes.map((a) => ({ attributeId: a.attribute_id, name: a.name, description: a.description })),
            });
            const parts = [
              r.added.length && `added ${r.added.join(", ")}`,
              r.renamed.length && `renamed ${r.renamed.map((x) => `${x.from} to ${x.to}`).join(", ")}`,
              r.restored.length && `brought back ${r.restored.join(", ")}`,
              r.archived.length && `archived ${r.archived.join(", ")}`,
              r.reordered && "reordered",
            ].filter(Boolean);
            return {
              summary: r.outcome === "updated" ? `Scorecard updated: ${parts.join("; ") || "descriptions changed"}.` : "Nothing to change.",
              data: {
                outcome: r.outcome, job_id: args.job_id, added: r.added, renamed: r.renamed, restored: r.restored,
                archived: r.archived, reordered: r.reordered, attributes: r.attributes.map(attributeOut),
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "get_activity",
        {
          title: "Get a candidate's activity",
          description:
            "One candidate's history, newest first (limit, default 30): when they were added to each job " +
            "and how they came in, stage moves with the reason they closed, owner and next-action changes, " +
            "the team's notes, interviews scheduled, done or cancelled, offers drafted, extended and closed " +
            "(status only; get_offers has the terms), tags put on them and emails sent to them (kind email, " +
            "the subject as text), each with who did it. Only what " +
            "you can read appears. An interviewer gets their own notes and the interviews they are on.",
          inputSchema: z.object({
            candidate_id: uuid("candidate_id"),
            limit: z.number().int().min(1).max(clientTools.LIST_MAX).optional(),
          }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("get_activity", "read", args, async () => {
            const a = await clientTools.getActivity(db, ctx, { candidateId: args.candidate_id, limit: args.limit });
            return {
              summary: `${a.entries.length} entr${a.entries.length === 1 ? "y" : "ies"}${a.full ? "" : " (your own notes and interviews)"}.`,
              data: {
                candidate_id: a.candidateId,
                full_history: a.full,
                // Nulls and empty lists left out: a timeline is long, and most fields belong to one kind.
                activity: a.entries.map((e) => Object.fromEntries(Object.entries({
                  at: e.at, kind: e.kind, by: e.actor, application_id: e.applicationId, job: e.jobTitle,
                  from_stage: e.fromStage, to_stage: e.toStage, source: e.source,
                  people: e.people.length ? e.people : null, text: fence("activity", e.text),
                  starts_at: e.startsAt, ref_id: e.refId,
                }).filter(([, v]) => v !== null))),
              },
              candidateIds: [a.candidateId],
            };
          }),
      );

      server.registerTool(
        "list_tags",
        {
          title: "List tags",
          description:
            "Your company's tags, each with a tag_id and how many of the candidates you can see carry it. " +
            "include_archived adds the archived ones. Not available to interviewers.",
          inputSchema: z.object({ include_archived: z.boolean().optional() }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_tags", "read", args, async () => {
            const tags = await clientTools.listTags(db, ctx, { includeArchived: args.include_archived });
            return {
              summary: `${tags.length} tag${tags.length === 1 ? "" : "s"}.`,
              data: { tags: tags.map((t) => ({ tag_id: t.tagId, name: fence("tag", t.name), archived: t.archived, candidates: t.candidates })) },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "create_tag",
        {
          title: "Create a tag",
          description:
            `Makes a tag your team can put on candidates (at most ${clientTools.TAG_NAME_MAX} characters). A tag ` +
            "already there under that name, ignoring case, is returned rather than duplicated; an admin " +
            "naming an archived one brings it back. For admins and anyone who can add candidates.",
          inputSchema: z.object({ name: z.string().min(1).max(clientTools.TAG_NAME_MAX) }),
        },
        (args) =>
          run("create_tag", "write", args, async () => {
            const r = await clientTools.createTag(db, ctx, { name: args.name });
            const summary = { created: "Tag created.", exists: "That tag already exists.", restored: "The archived tag is back." }[r.outcome];
            return { summary, data: { outcome: r.outcome, tag_id: r.tagId, name: fence("tag", r.name) }, candidateIds: [] };
          }),
      );

      server.registerTool(
        "tag_candidate",
        {
          title: "Tag a candidate",
          description:
            "Puts a tag (its name or tag_id, from list_tags) on a candidate (candidate_id). Tagging someone " +
            "already tagged changes nothing. Needs the right to change that candidate; archived tags go on no one.",
          inputSchema: z.object({ candidate_id: uuid("candidate_id"), tag: z.string().min(1).max(100) }),
        },
        (args) =>
          run("tag_candidate", "write", args, async () => {
            const r = await clientTools.tagCandidate(db, ctx, { candidateId: args.candidate_id, tag: args.tag });
            return {
              summary: r.outcome === "tagged" ? "Tagged." : "Already tagged. Nothing changed.",
              data: { outcome: r.outcome, candidate_id: args.candidate_id, tag_id: r.tagId, tag: fence("tag", r.tag) },
              candidateIds: [args.candidate_id],
            };
          }),
      );

      server.registerTool(
        "untag_candidate",
        {
          title: "Take a tag off a candidate",
          description:
            "Takes a tag (its name or tag_id) off a candidate (candidate_id). Needs the right to change that " +
            "candidate. Confirm with the user first.",
          inputSchema: z.object({ candidate_id: uuid("candidate_id"), tag: z.string().min(1).max(100) }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("untag_candidate", "write", args, async () => {
            const r = await clientTools.untagCandidate(db, ctx, { candidateId: args.candidate_id, tag: args.tag });
            return {
              summary: r.outcome === "untagged" ? "Tag removed." : "They did not have that tag. Nothing changed.",
              data: { outcome: r.outcome, candidate_id: args.candidate_id, tag_id: r.tagId, tag: fence("tag", r.tag) },
              candidateIds: [args.candidate_id],
            };
          }),
      );

      server.registerTool(
        "archive_tag",
        {
          title: "Archive a tag",
          description:
            "Archives a tag (its name or tag_id): it stays on the candidates who have it and goes on no one " +
            "new; create_tag with its name brings it back. Admins only. Confirm with the user first.",
          inputSchema: z.object({ tag: z.string().min(1).max(100) }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("archive_tag", "write", args, async () => {
            const r = await clientTools.archiveTag(db, ctx, { tag: args.tag });
            return {
              summary: r.outcome === "archived" ? "Tag archived." : "Already archived. Nothing changed.",
              data: { outcome: r.outcome, tag_id: r.tagId, name: fence("tag", r.name) },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "list_email_templates",
        {
          title: "List email templates",
          description:
            "Your company's email templates, each with a template_id, its subject and body. include_archived " +
            "adds the archived ones. Use one with draft_email. Not available to interviewers. " + PLACEHOLDER_HELP,
          inputSchema: z.object({ include_archived: z.boolean().optional() }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_email_templates", "read", args, async () => {
            const templates = await clientTools.listEmailTemplates(db, ctx, { includeArchived: args.include_archived });
            return {
              summary: `${templates.length} template${templates.length === 1 ? "" : "s"}.`,
              data: { templates: templates.map(templateOut), placeholders: clientTools.EMAIL_PLACEHOLDERS },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "create_email_template",
        {
          title: "Create an email template",
          description:
            "Makes an email template your team can use with draft_email: a name (unique, ignoring case), a " +
            "one-line subject and a body. Admins only. " + PLACEHOLDER_HELP,
          inputSchema: z.object({
            name: z.string().min(1).max(clientTools.TEMPLATE_NAME_MAX),
            subject: z.string().min(1).max(clientTools.EMAIL_SUBJECT_MAX),
            body: z.string().min(1).max(clientTools.EMAIL_BODY_MAX),
          }),
        },
        (args) =>
          // The subject and body stay out of the call log, like a note's text.
          run("create_email_template", "write", { name: args.name }, async () => {
            const r = await clientTools.createEmailTemplate(db, ctx, { name: args.name, subject: args.subject, body: args.body });
            return {
              summary: "Template made.",
              data: { template_id: r.templateId, name: fence("template", r.name) },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "update_email_template",
        {
          title: "Change or archive an email template",
          description:
            "Changes an email template (its name or template_id): a new name, subject or body, or archived: " +
            "true to retire it (it is kept, and drafts already written from it are untouched) or false to " +
            "bring it back. Templates are never deleted. Admins only. Tell the user what will change and wait " +
            "for a yes first. " + PLACEHOLDER_HELP,
          inputSchema: z.object({
            template: z.string().min(1).max(clientTools.TEMPLATE_NAME_MAX),
            name: z.string().min(1).max(clientTools.TEMPLATE_NAME_MAX).optional(),
            subject: z.string().min(1).max(clientTools.EMAIL_SUBJECT_MAX).optional(),
            body: z.string().min(1).max(clientTools.EMAIL_BODY_MAX).optional(),
            archived: z.boolean().optional(),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("update_email_template", "write", { ...args, subject: undefined, body: undefined }, async () => {
            const r = await clientTools.updateEmailTemplate(db, ctx, {
              template: args.template, name: args.name, subject: args.subject, body: args.body, archived: args.archived,
            });
            return {
              summary: r.outcome === "updated" ? `Template changed: ${r.changed.join(", ")}.` : "Nothing to change.",
              data: { outcome: r.outcome, template_id: r.templateId, name: fence("template", r.name), archived: r.archived, changed: r.changed },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "draft_email",
        {
          title: "Draft an email to a candidate",
          description:
            "Writes a draft email to a candidate (candidate_id) and sends nothing: from a template (its name " +
            "or template_id, from list_email_templates) or from a subject and body you write from what the " +
            "user asked for (given with a template, they replace its subject or body). application_id ties it " +
            "to one of their jobs and fills {{job_title}}. It goes to their email on file, or to_email when " +
            "that is another address on file for them. It is From your name at a Tacit address, and replies " +
            "come to your own email. Never put interview feedback, scorecards, offer terms or private notes " +
            "in it. Show the user the returned to, subject and full body exactly, then send it with " +
            "send_email only once they say yes; to change it, draft again. Needs the right to change the " +
            "candidate; interviewers cannot email candidates. " + PLACEHOLDER_HELP,
          inputSchema: z.object({
            candidate_id: uuid("candidate_id"),
            application_id: uuid("application_id").optional(),
            template: z.string().min(1).max(clientTools.TEMPLATE_NAME_MAX).optional(),
            subject: z.string().min(1).max(clientTools.EMAIL_SUBJECT_MAX).optional(),
            body: z.string().min(1).max(clientTools.EMAIL_BODY_MAX).optional(),
            to_email: z.string().max(320).optional(),
          }),
        },
        (args) =>
          run("draft_email", "write", { ...args, subject: undefined, body: undefined }, async () => {
            const r = await clientTools.draftEmail(db, ctx, deps.email, {
              candidateId: args.candidate_id, applicationId: args.application_id, template: args.template,
              subject: args.subject, body: args.body, toEmail: args.to_email,
            });
            return {
              summary:
                "Draft written; nothing has been sent. Show the user the whole email below and call send_email " +
                "with this draft_id only after they say to send it.",
              data: {
                draft_id: r.draftId, candidate_id: r.candidateId, application_id: r.applicationId, template_id: r.templateId,
                from: r.from, reply_to: r.replyTo, to: r.to, subject: fence("subject", r.subject), body: fence("body", r.body),
              },
              candidateIds: [r.candidateId],
            };
          }),
      );

      server.registerTool(
        "send_email",
        {
          title: "Send a drafted email",
          description:
            "Sends one draft from draft_email (draft_id) to the candidate, exactly as drafted. Only its author " +
            "can send it, once; it is then on the candidate's record (get_candidate, list_emails, " +
            "get_activity). Call this only after showing the user the draft and hearing an explicit yes. " +
            `At most ${clientTools.CLIENT_SENDS_PER_HOUR} sends an hour.`,
          inputSchema: z.object({ draft_id: uuid("draft_id") }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("send_email", "write", args, async () => {
            const r = await clientTools.sendEmail(db, ctx, deps.email, { draftId: args.draft_id });
            return {
              summary: `Sent to ${r.to}.`,
              data: {
                email_id: r.emailId, candidate_id: r.candidateId, application_id: r.applicationId, to: r.to,
                subject: fence("subject", r.subject), status: r.status, sent_at: r.sentAt,
              },
              candidateIds: [r.candidateId],
            };
          }),
      );

      server.registerTool(
        "list_emails",
        {
          title: "List a candidate's emails",
          description:
            "The emails to one candidate (candidate_id) that you can read, newest first, with their bodies: " +
            "every one sent or being sent, and your own drafts. Each has its status (draft, sending, sent, " +
            "failed), who wrote it and when it went. Not available to interviewers.",
          inputSchema: z.object({ candidate_id: uuid("candidate_id") }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_emails", "read", args, async () => {
            const emails = await clientTools.listEmails(db, ctx, { candidateId: args.candidate_id });
            return {
              summary: `${emails.length} email${emails.length === 1 ? "" : "s"}.`,
              data: {
                candidate_id: args.candidate_id,
                emails: emails.map((e) => ({ ...emailOut(e), body: fence("body", e.body) })),
              },
              candidateIds: [args.candidate_id],
            };
          }),
      );

      // Approvals (core's clientTools approvals.ts). Job titles and teammates' names are bare;
      // candidate names and approvers' reasons are fenced.
      const APPROVAL_KIND_HELP =
        "kind offer gates extending the job's offers, job_open gates moving the job to open";

      server.registerTool(
        "get_approval_flow",
        {
          title: "Get a job's approval flow",
          description:
            `A job's approval flow of one kind (${APPROVAL_KIND_HELP}): its steps in order, each with the ` +
            "approvers who can pass it (any one of them), and for job_open the latest request to open the " +
            "job with each decision. No steps means nothing is gated. For the people who manage the job " +
            "and the flow's approvers.",
          inputSchema: z.object({ job_id: uuid("job_id"), kind: z.enum(clientTools.APPROVAL_KINDS) }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("get_approval_flow", "read", args, async () => {
            const f = await clientTools.getApprovalFlow(db, ctx, { jobId: args.job_id, kind: args.kind });
            const latest = f.latestRequest;
            return {
              summary: f.steps.length
                ? `${f.steps.length} approval step${f.steps.length === 1 ? "" : "s"} for ${args.kind === "offer" ? "offers" : "opening the job"}.`
                : "No approval flow: nothing is gated.",
              data: {
                job_id: f.jobId, title: f.title, kind: f.kind,
                steps: f.steps.map((s) => ({
                  step: s.step, approvers: s.approvers.map((a) => ({ user_id: a.userId, name: a.name, active: a.active })),
                })),
                updated_by: f.updatedBy, updated_at: f.updatedAt,
                latest_request: latest
                  ? {
                      request_id: latest.requestId, status: latest.status, waiting_step: latest.waitingStep,
                      requested_by: latest.requestedBy, requested_at: latest.requestedAt, resolved_at: latest.resolvedAt,
                      used_at: latest.usedAt, decisions: latest.decisions.map(decisionOut),
                    }
                  : null,
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "set_approval_flow",
        {
          title: "Set a job's approval flow",
          description:
            `Sets who must approve, in order, before something happens on a job (${APPROVAL_KIND_HELP}). ` +
            `steps is a list of at most ${clientTools.APPROVAL_STEPS_MAX} steps, each a list of user ids ` +
            "(from list_team) of whom any one approves that step, e.g. [[hiring_manager_id], [cfo_id, ceo_id]]. " +
            "The list given replaces the flow; [] removes it, and then nothing is gated. Changing the flow " +
            "resets every approval asked for or given under the old one. An approver sees the job title, " +
            "and for an offer the candidate's name and terms, while it waits on them. Whoever manages the " +
            "job. Tell the user exactly what will change and wait for a yes.",
          inputSchema: z.object({
            job_id: uuid("job_id"),
            kind: z.enum(clientTools.APPROVAL_KINDS),
            steps: z.array(z.array(uuid("each approver")).min(1).max(clientTools.APPROVERS_PER_STEP_MAX))
              .max(clientTools.APPROVAL_STEPS_MAX),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("set_approval_flow", "write", args, async () => {
            const r = await clientTools.setApprovalFlow(db, ctx, { jobId: args.job_id, kind: args.kind, steps: args.steps });
            const reset = r.requestsReset ? ` ${r.requestsReset} approval${r.requestsReset === 1 ? "" : "s"} in progress started over.` : "";
            const summary = {
              set: `Approval flow set: ${r.steps} step${r.steps === 1 ? "" : "s"}.${reset}`,
              cleared: `Approval flow removed: nothing is gated now.${reset}`,
              unchanged: "That is already the flow. Nothing changed.",
            }[r.outcome];
            return { summary, data: { outcome: r.outcome, job_id: args.job_id, kind: args.kind, steps: r.steps, requests_reset: r.requestsReset }, candidateIds: [] };
          }),
      );

      server.registerTool(
        "request_approval",
        {
          title: "Ask for an approval",
          description:
            "Starts the approval flow for a draft offer (offer_id) or for opening a job (job_id), when the " +
            "job has a flow of that kind. The first step's approvers see it in list_my_approvals; nothing " +
            "is emailed. One request at a time: asking again returns the one in progress or already " +
            "approved. A rejected request can be asked again. Whoever manages the job.",
          inputSchema: z.object({ offer_id: uuid("offer_id").optional(), job_id: uuid("job_id").optional() }),
        },
        (args) =>
          run("request_approval", "write", args, async () => {
            const r = await clientTools.requestApproval(db, ctx, { offerId: args.offer_id, jobId: args.job_id });
            const what = r.kind === "offer" ? "the offer" : "opening the job";
            const summary = {
              requested: `Approval of ${what} requested. Waiting on ${r.firstStep.join(" or ")}.`,
              already_pending: `Approval of ${what} was already requested and is waiting.`,
              already_approved: `${r.kind === "offer" ? "The offer" : "Opening the job"} is already approved.`,
            }[r.outcome];
            return {
              summary,
              data: { outcome: r.outcome, request_id: r.requestId, kind: r.kind, status: r.status, first_step: r.firstStep },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "list_my_approvals",
        {
          title: "List approvals waiting on me",
          description:
            "The approvals waiting on you: each request's kind (offer or job_open), the job, the step it " +
            "waits on and how many there are, who asked and when, and for an offer the candidate and the " +
            "terms to approve. Act on one with approve or reject. Offer terms are confidential: share them " +
            "only with the user.",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_my_approvals", "read", args, async () => {
            const items = await clientTools.listMyApprovals(db, ctx);
            return {
              summary: items.length ? `${items.length} approval${items.length === 1 ? "" : "s"} waiting on you.` : "Nothing is waiting on you.",
              data: {
                approvals: items.map((a) => ({
                  request_id: a.requestId, kind: a.kind, waiting_step: a.waitingStep, steps: a.steps,
                  job_id: a.jobId, job_title: a.jobTitle, job_status: a.jobStatus,
                  requested_by: a.requestedBy, requested_at: a.requestedAt,
                  offer_id: a.offerId, application_id: a.applicationId, candidate_id: a.candidateId,
                  candidate: a.candidateId ? named(a.candidateName) : null,
                  terms: a.terms
                    ? {
                        salary: a.terms.salary, currency: a.terms.currency, bonus: a.terms.bonus, equity: a.terms.equity,
                        start_date: a.terms.startDate, expires_on: a.terms.expiresOn,
                      }
                    : null,
                })),
              },
              candidateIds: items.map((a) => a.candidateId).filter((id): id is string => !!id),
            };
          }),
      );

      const decided = (r: clientTools.DecisionResult): string =>
        ({
          advanced: `Approved your step; it now waits on step ${r.waitingStep}.`,
          approved: r.kind === "offer"
            ? "Approved. That was the last step: the offer can be extended."
            : "Approved. That was the last step: the job can be opened.",
          rejected: r.kind === "offer"
            ? "Rejected. The offer stays a draft; whoever asked can change it and ask again."
            : "Rejected. The job stays as it was; whoever asked can ask again.",
          not_pending: `Nothing changed: that request is no longer waiting (${r.status}).`,
        })[r.outcome];
      const decisionData = (r: clientTools.DecisionResult, requestId: string) => ({
        outcome: r.outcome, request_id: requestId, status: r.status, waiting_step: r.waitingStep,
        kind: r.kind, offer_id: r.offerId, job_id: r.jobId,
      });

      server.registerTool(
        "approve",
        {
          title: "Approve",
          description:
            "Approves the step a request (request_id, from list_my_approvals) waits on, when you are one of " +
            "that step's approvers: it moves to the next step, or after the last one the offer can be " +
            "extended or the job opened. An optional comment is kept with the decision. Tell the user " +
            "exactly what they are approving and wait for a yes.",
          inputSchema: z.object({
            request_id: uuid("request_id"),
            comment: z.string().max(clientTools.APPROVAL_REASON_MAX).optional(),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("approve", "write", { request_id: args.request_id }, async () => {
            const r = await clientTools.decideApproval(db, ctx, { requestId: args.request_id, decision: "approve", reason: args.comment });
            return { summary: decided(r), data: decisionData(r, args.request_id), candidateIds: [] };
          }),
      );

      server.registerTool(
        "reject",
        {
          title: "Reject an approval",
          description:
            "Rejects a request (request_id, from list_my_approvals) at the step it waits on, when you are " +
            "one of that step's approvers, with a reason whoever asked will see. The offer stays a draft " +
            "(or the job as it was), and they can ask again. Tell the user exactly what they are rejecting " +
            "and wait for a yes.",
          inputSchema: z.object({
            request_id: uuid("request_id"),
            reason: z.string().min(1).max(clientTools.APPROVAL_REASON_MAX),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("reject", "write", { request_id: args.request_id }, async () => {
            const r = await clientTools.decideApproval(db, ctx, { requestId: args.request_id, decision: "reject", reason: args.reason });
            return { summary: decided(r), data: decisionData(r, args.request_id), candidateIds: [] };
          }),
      );

      const FIELD_OBJECT_HELP =
        "A field is on a candidate, a job or an offer. Types: short_text, long_text, number, date (YYYY-MM-DD), " +
        "yes_no, single_select and multi_select (from the field's options), url. A private field is read and " +
        "set only by admins and the people who manage the job.";
      const fieldOut = (f: clientTools.CustomField) => ({
        field_id: f.fieldId, object: f.object, name: f.name, type: f.type, private: f.private, archived: f.archived,
        ...(f.options.length ? { options: f.options.map((o) => ({ option_id: o.optionId, name: o.name, archived: o.archived })) } : {}),
      });

      server.registerTool(
        "list_custom_fields",
        {
          title: "List custom fields",
          description:
            "Your company's custom fields, each with a field_id, its object, type, whether it is private, and " +
            "for a select field its options (option_id and name). object narrows to candidate, job or offer; " +
            `include_archived adds archived fields and options. ${FIELD_OBJECT_HELP} Values show in ` +
            "get_candidate, list_jobs, get_pipeline and get_offers. Not available to interviewers.",
          inputSchema: z.object({
            object: z.enum(clientTools.CUSTOM_FIELD_OBJECTS).optional(),
            include_archived: z.boolean().optional(),
          }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_custom_fields", "read", args, async () => {
            const fields = await clientTools.listCustomFields(db, ctx, { object: args.object, includeArchived: args.include_archived });
            return {
              summary: `${fields.length} custom field${fields.length === 1 ? "" : "s"}.`,
              data: { fields: fields.map(fieldOut) },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "create_custom_field",
        {
          title: "Create a custom field",
          description:
            `Defines a custom field for your company (admins). ${FIELD_OBJECT_HELP} A select field needs its ` +
            `options, in order (at most ${clientTools.CUSTOM_FIELD_OPTIONS_MAX}). A field already there under that ` +
            "name on that object, ignoring case, is returned rather than duplicated. The object and type never " +
            "change afterwards.",
          inputSchema: z.object({
            object: z.enum(clientTools.CUSTOM_FIELD_OBJECTS),
            name: z.string().min(1).max(clientTools.CUSTOM_FIELD_NAME_MAX),
            type: z.enum(clientTools.CUSTOM_FIELD_TYPES),
            private: z.boolean().optional(),
            options: z.array(z.string().min(1).max(clientTools.CUSTOM_FIELD_OPTION_MAX)).max(clientTools.CUSTOM_FIELD_OPTIONS_MAX).optional(),
          }),
        },
        (args) =>
          run("create_custom_field", "write", args, async () => {
            const r = await clientTools.createCustomField(db, ctx, {
              object: args.object, name: args.name, type: args.type, private: args.private, options: args.options,
            });
            return {
              summary: r.outcome === "created" ? "Custom field created." : "That field already exists. Nothing changed.",
              data: { outcome: r.outcome, field_id: r.fieldId, name: r.name },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "update_custom_field",
        {
          title: "Change a custom field",
          description:
            "Renames a custom field (field: its field_id, or its name with object), makes it private or not, " +
            "archives it (archived: true; its values stay on record and it takes no new ones) or brings it " +
            "back, and for a select field sets its options: the list given becomes the live options in that " +
            "order, an entry with an option_id renaming that option, one without matched by name or added, " +
            "and live options left out archived (never deleted: a candidate who has one keeps it). Admins " +
            "only. Tell the user what will change and wait for a yes.",
          inputSchema: z.object({
            field: z.string().min(1).max(200),
            object: z.enum(clientTools.CUSTOM_FIELD_OBJECTS).optional(),
            name: z.string().min(1).max(clientTools.CUSTOM_FIELD_NAME_MAX).optional(),
            private: z.boolean().optional(),
            archived: z.boolean().optional(),
            options: z.array(z.object({
              option_id: uuid("option_id").optional(),
              name: z.string().min(1).max(clientTools.CUSTOM_FIELD_OPTION_MAX),
            })).max(clientTools.CUSTOM_FIELD_OPTIONS_MAX).optional(),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("update_custom_field", "write", args, async () => {
            const r = await clientTools.updateCustomField(db, ctx, {
              field: args.field, object: args.object, name: args.name, private: args.private, archived: args.archived,
              options: args.options?.map((o) => ({ optionId: o.option_id, name: o.name })),
            });
            const parts = [
              r.changed.filter((c) => c !== "options").join(", "),
              r.added.length && `added ${r.added.join(", ")}`,
              r.renamed.length && `renamed ${r.renamed.map((x) => `${x.from} to ${x.to}`).join(", ")}`,
              r.restored.length && `brought back ${r.restored.join(", ")}`,
              r.archivedOptions.length && `archived ${r.archivedOptions.join(", ")}`,
            ].filter(Boolean);
            return {
              summary: r.outcome === "updated" ? `Field updated: ${parts.join("; ")}.` : "Nothing to change.",
              data: {
                outcome: r.outcome, field_id: r.fieldId, name: r.name, changed: r.changed, options_added: r.added,
                options_renamed: r.renamed, options_restored: r.restored, options_archived: r.archivedOptions,
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "set_custom_field",
        {
          title: "Set a custom field",
          description:
            "Sets one custom field (field: its field_id or name) on one candidate, job or offer (object, and " +
            "object_id: a candidate_id, job_id or offer_id). value is text, a number, true or false, a date " +
            "YYYY-MM-DD, an http(s) link, an option's name or option_id, or a list of them for multi_select; " +
            "null clears it. A candidate's fields are set by whoever can change the candidate, a job's by " +
            "whoever manages it, an offer's by whoever manages its job and only while it is a draft. Not " +
            "available to interviewers.",
          inputSchema: z.object({
            object: z.enum(clientTools.CUSTOM_FIELD_OBJECTS),
            object_id: uuid("object_id"),
            field: z.string().min(1).max(200),
            value: z.union([
              z.string().max(clientTools.LONG_TEXT_MAX),
              z.number(),
              z.boolean(),
              z.array(z.string().max(200)).max(clientTools.CUSTOM_FIELD_OPTIONS_MAX),
            ]).nullable(),
          }),
        },
        (args) =>
          // The value can be free text about a candidate: it stays out of the call log.
          run("set_custom_field", "write", { ...args, value: undefined }, async () => {
            const r = await clientTools.setCustomField(db, ctx, {
              object: args.object, objectId: args.object_id, field: args.field, value: args.value,
            });
            const summary = {
              set: `${r.field} set.`,
              cleared: `${r.field} cleared.`,
              unchanged: `${r.field} is already that. Nothing changed.`,
            }[r.outcome];
            return {
              summary,
              data: {
                outcome: r.outcome, object: args.object, object_id: args.object_id, field_id: r.fieldId, field: r.field,
                type: r.type, value: customValueOut(r.type, r.value),
              },
              candidateIds: args.object === "candidate" ? [args.object_id] : [],
            };
          }),
      );
      // Departments, offices and openings (20261016130000_client_org_structure).
      // Department and office names and opening codes are bare like job
      // titles: an admin's own labels, passed back verbatim. A close reason
      // is free text and fenced; so is the name of whoever filled an opening.
      server.registerTool(
        "list_departments",
        {
          title: "List departments",
          description:
            "Your company's departments, each with a department_id, its place (\"Engineering > Platform\") " +
            "and how many of the jobs you can see are in it. include_archived adds the archived ones. Not " +
            "available to interviewers.",
          inputSchema: z.object({ include_archived: z.boolean().optional() }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_departments", "read", args, async () => {
            const list = await clientTools.listDepartments(db, ctx, { includeArchived: args.include_archived });
            return {
              summary: `${list.length} department${list.length === 1 ? "" : "s"}.`,
              data: {
                departments: list.map((d) => ({
                  department_id: d.departmentId, name: d.name, path: d.path, parent_id: d.parentId, archived: d.archived, jobs: d.jobs,
                })),
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "create_department",
        {
          title: "Create a department",
          description:
            `Makes a department (at most ${clientTools.DEPARTMENT_NAME_MAX} characters), optionally inside ` +
            "another (parent: a name or department_id). One already there under that name, ignoring case, " +
            "is returned rather than duplicated, and an archived one is brought back. Admins only.",
          inputSchema: z.object({
            name: z.string().min(1).max(clientTools.DEPARTMENT_NAME_MAX),
            parent: z.string().min(1).max(100).optional(),
          }),
        },
        (args) =>
          run("create_department", "write", args, async () => {
            const r = await clientTools.createDepartment(db, ctx, { name: args.name, parent: args.parent });
            const summary = {
              created: "Department created.", exists: "That department already exists.", restored: "The archived department is back.",
            }[r.outcome];
            return { summary, data: { outcome: r.outcome, department_id: r.id, name: r.name, parent: r.parent }, candidateIds: [] };
          }),
      );

      server.registerTool(
        "update_department",
        {
          title: "Update a department",
          description:
            "Renames a department (department: its name or department_id), moves it inside another (parent, " +
            "null for the top level), or archives it (archived: true; its jobs keep it, and it goes on no new " +
            "job) or brings it back (archived: false). Nothing deletes a department. Admins only. Tell the " +
            "user what will change and wait for a yes.",
          inputSchema: z.object({
            department: z.string().min(1).max(100),
            name: z.string().min(1).max(clientTools.DEPARTMENT_NAME_MAX).optional(),
            parent: z.string().min(1).max(100).nullable().optional(),
            archived: z.boolean().optional(),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("update_department", "write", args, async () => {
            const r = await clientTools.updateDepartment(db, ctx, {
              department: args.department, name: args.name, parent: args.parent, archived: args.archived,
            });
            return {
              summary: r.outcome === "updated" ? `Updated ${r.changed.join(", ")}.` : "Nothing to change.",
              data: { outcome: r.outcome, department_id: r.departmentId, changed: r.changed },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "list_offices",
        {
          title: "List offices",
          description:
            "Your company's offices, each with an office_id, its location and how many of the jobs you can " +
            "see are in it. include_archived adds the archived ones. Not available to interviewers.",
          inputSchema: z.object({ include_archived: z.boolean().optional() }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_offices", "read", args, async () => {
            const list = await clientTools.listOffices(db, ctx, { includeArchived: args.include_archived });
            return {
              summary: `${list.length} office${list.length === 1 ? "" : "s"}.`,
              data: {
                offices: list.map((o) => ({ office_id: o.officeId, name: o.name, location: o.location, archived: o.archived, jobs: o.jobs })),
              },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "create_office",
        {
          title: "Create an office",
          description:
            `Makes an office (a name of at most ${clientTools.OFFICE_NAME_MAX} characters, and an optional ` +
            "location such as \"New York, NY\"). One already there under that name, ignoring case, is " +
            "returned rather than duplicated, and an archived one is brought back. Admins only.",
          inputSchema: z.object({
            name: z.string().min(1).max(clientTools.OFFICE_NAME_MAX),
            location: z.string().min(1).max(clientTools.OFFICE_LOCATION_MAX).optional(),
          }),
        },
        (args) =>
          run("create_office", "write", args, async () => {
            const r = await clientTools.createOffice(db, ctx, { name: args.name, location: args.location });
            const summary = {
              created: "Office created.", exists: "That office already exists.", restored: "The archived office is back.",
            }[r.outcome];
            return { summary, data: { outcome: r.outcome, office_id: r.id, name: r.name }, candidateIds: [] };
          }),
      );

      server.registerTool(
        "update_office",
        {
          title: "Update an office",
          description:
            "Renames an office (office: its name or office_id), changes its location (null clears it), or " +
            "archives it (archived: true; its jobs keep it, and it goes on no new job) or brings it back. " +
            "Nothing deletes an office. Admins only. Tell the user what will change and wait for a yes.",
          inputSchema: z.object({
            office: z.string().min(1).max(100),
            name: z.string().min(1).max(clientTools.OFFICE_NAME_MAX).optional(),
            location: z.string().max(clientTools.OFFICE_LOCATION_MAX).nullable().optional(),
            archived: z.boolean().optional(),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("update_office", "write", args, async () => {
            const r = await clientTools.updateOffice(db, ctx, {
              office: args.office, name: args.name, location: args.location, archived: args.archived,
            });
            return {
              summary: r.outcome === "updated" ? `Updated ${r.changed.join(", ")}.` : "Nothing to change.",
              data: { outcome: r.outcome, office_id: r.officeId, changed: r.changed },
              candidateIds: [],
            };
          }),
      );

      const openingOut = (o: clientTools.Opening) => ({
        opening_id: o.openingId, number: o.number, code: o.code, status: o.status, target_start_date: o.targetStartDate,
        close_reason: fence("close reason", o.closeReason), filled_by_application_id: o.filledByApplicationId,
        filled_by_candidate_id: o.filledByCandidateId, filled_by: fence("name", o.filledByName),
        filled_at: o.filledAt, closed_at: o.closedAt,
      });

      server.registerTool(
        "list_openings",
        {
          title: "List a job's openings",
          description:
            "A job's openings, the people it is hiring (Greenhouse's headcount): each with an opening_id, " +
            "its number on the job, your opening code if it has one, status (open, filled, closed), target " +
            "start date, why it closed, and who filled it. Moving someone to hired fills the oldest open " +
            "opening by itself, and the job becomes filled when none is left open. status narrows the list. " +
            "For the hiring team and admins; not interviewers or external recruiters.",
          inputSchema: z.object({ job_id: uuid("job_id"), status: z.enum(clientTools.OPENING_STATUSES).optional() }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_openings", "read", args, async () => {
            const j = await clientTools.listOpenings(db, ctx, { jobId: args.job_id, status: args.status });
            const ids = j.openings.map((o) => o.filledByCandidateId).filter((id): id is string => !!id);
            return {
              summary: `${j.title}: ${j.counts.open} open, ${j.counts.filled} filled, ${j.counts.closed} closed.`,
              data: { job_id: j.jobId, title: j.title, job_status: j.jobStatus, counts: j.counts, openings: j.openings.map(openingOut) },
              candidateIds: [...new Set(ids)],
            };
          }),
      );

      server.registerTool(
        "add_openings",
        {
          title: "Add openings to a job",
          description:
            `Adds count openings to a job (1 to ${clientTools.OPENINGS_ADD_MAX}, 1 if not said), each with ` +
            "your opening code if you give codes (one per opening, unique at your company) and an optional " +
            "target_start_date (YYYY-MM-DD). It does not reopen a filled or closed job: update_job does. " +
            "For admins and whoever manages the job. Confirm the count with the user first.",
          inputSchema: z.object({
            job_id: uuid("job_id"),
            count: z.number().int().min(1).max(clientTools.OPENINGS_ADD_MAX).optional(),
            codes: z.array(z.string().min(1).max(clientTools.OPENING_CODE_MAX)).max(clientTools.OPENINGS_ADD_MAX).optional(),
            target_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional(),
          }),
        },
        (args) =>
          run("add_openings", "write", args, async () => {
            const r = await clientTools.addOpenings(db, ctx, {
              jobId: args.job_id, count: args.count, codes: args.codes, targetStartDate: args.target_start_date,
            });
            const n = r.added.length;
            const jobNote = r.jobStatus === "open" ? "" : ` The job is ${r.jobStatus}; update_job opens it again.`;
            return {
              summary: `Added ${n} opening${n === 1 ? "" : "s"}; ${r.counts.open} open now.${jobNote}`,
              data: { job_id: r.jobId, job_status: r.jobStatus, counts: r.counts, added: r.added.map(openingOut) },
              candidateIds: [],
            };
          }),
      );

      server.registerTool(
        "close_opening",
        {
          title: "Close an opening",
          description:
            "Closes one open opening (opening_id from list_openings) without a hire, with a reason (e.g. " +
            "\"Budget moved to next year\"). A filled opening is not closed: moving its hire out of hired " +
            "opens it again. Closing the last open opening does not change the job's status. For admins and " +
            "whoever manages the job. Tell the user what will change and wait for a yes.",
          inputSchema: z.object({ opening_id: uuid("opening_id"), reason: z.string().min(1).max(clientTools.CLOSE_REASON_MAX) }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("close_opening", "write", { opening_id: args.opening_id }, async () => {
            const r = await clientTools.closeOpening(db, ctx, { openingId: args.opening_id, reason: args.reason });
            return {
              summary: (r.outcome === "closed" ? `Closed opening #${r.number}.` : `Opening #${r.number} was already closed. Nothing changed.`) +
                ` ${r.counts.open} still open on the job.`,
              data: { outcome: r.outcome, opening_id: r.openingId, job_id: r.jobId, number: r.number, counts: r.counts },
              candidateIds: [],
            };
          }),
      );
    },
    {
      serverInfo: { name: "tacit-client", version: "0.1.0" },
      instructions:
        "Your company's hiring workspace in Tacit: its jobs, the candidates in each job's pipeline, and " +
        "your team. You act as the signed-in member, and Tacit shows and changes only what their access " +
        "allows. Call whoami first. When you only have a name, call search_candidates and use the ids it " +
        "returns. Before update_stage, update_job, set_member_access, invite_member, update_interview, " +
        "create_offer, update_offer, set_interview_plan, untag_candidate, archive_tag, " +
        "update_email_template, update_custom_field, update_department, update_office, close_opening or removing someone from a hiring team, tell the user exactly what will " +
        "change and wait for a yes. Email to a candidate is always two steps: draft_email, show the user " +
        "the whole draft, then send_email only after their explicit yes. Nothing here " +
        "deletes a candidate or a job. Interview feedback is private to the hiring team: never put it " +
        "in a message to a candidate. Offer terms are confidential: share them only with the user. " +
        "Approvals: before set_approval_flow, approve or reject, tell the user exactly what they are " +
        "setting, approving or rejecting and wait for their yes; never approve or reject on your own.\n\n" +
        UNTRUSTED_PREAMBLE,
    },
  );
}
