import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  APPLICATION_STAGES, UNTRUSTED_PREAMBLE, clientTools, wrapUntrusted, type IdentityProvider, type InvitationRevoker,
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
    owner: c.ownerName,
    last_touch_at: c.lastTouchAt,
    next_action: c.nextAction,
    next_action_due: c.nextActionDue,
    needs_attention: c.stalled,
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
            "team and admins) how many candidates are in it. status narrows to one status, e.g. open.",
          inputSchema: z.object({ status: z.string().max(40).optional() }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("list_jobs", "read", args, async () => {
            const jobs = await clientTools.listJobs(db, ctx, { status: args.status });
            return {
              summary: `${jobs.length} job${jobs.length === 1 ? "" : "s"}.`,
              data: {
                jobs: jobs.map((j) => ({
                  job_id: j.jobId, title: j.title, status: j.status, location: j.location, level: j.seniority, candidates: j.inPipeline,
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
              data: { job_id: p.jobId, title: p.title, status: p.status, candidates: p.cards.map(cardOut) },
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
            "in one job (job_id). Returns candidate_id and the jobs each is in, with application_id and " +
            "stage. An interviewer finds only the people they interview.",
          inputSchema: z.object({
            query: z.string().max(200).optional(),
            job_id: uuid("job_id").optional(),
            limit: z.number().int().min(1).max(clientTools.LIST_MAX).optional(),
          }),
          annotations: { readOnlyHint: true },
        },
        (args) =>
          run("search_candidates", "read", args, async () => {
            const hits = await clientTools.searchCandidates(db, ctx, { query: args.query, jobId: args.job_id, limit: args.limit });
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
            "One candidate by candidate_id: their profile, the jobs they are in (application_id, stage, " +
            "next action, why they closed, and the latest offer if you manage the job) and the team's notes. An interviewer gets the name, headline and LinkedIn of " +
            "someone they interview, and their own notes.",
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
                jobs: c.applications.map((a) => ({
                  application_id: a.applicationId, job_id: a.jobId, job: a.jobTitle, stage: a.stage,
                  next_action: a.nextAction, next_action_due: a.nextActionDue, last_touch_at: a.lastTouchAt,
                  rejection_reason: a.rejectionReason, rejection_note: fence("note", a.rejectionNote),
                  offer: a.offer ? { offer_id: a.offer.offerId, status: a.offer.status } : null,
                })),
                notes: c.notes.map((n) => ({ note_id: n.noteId, text: fence("note", n.text), author: n.author, created_at: n.createdAt, yours: n.mine })),
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
            "left where they are. Needs hiring-team access to the job.",
          inputSchema: z.object({
            job_id: uuid("job_id"),
            name: z.string().min(1).max(200),
            email: z.string().max(320).optional(),
            linkedin_url: z.string().max(500).optional(),
          }),
        },
        (args) =>
          run("add_candidate", "write", args, async () => {
            const r = await clientTools.addCandidate(db, ctx, {
              jobId: args.job_id, name: args.name, email: args.email, linkedinUrl: args.linkedin_url,
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
            return {
              summary,
              data: { outcome: r.outcome, application_id: args.application_id, stage: r.stage, rejection_reason: r.reason },
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
            "job_id; add the people who work it with add_to_hiring_team. Confirm the details with the user first.",
          inputSchema: z.object({
            title: z.string().min(1).max(200),
            status: z.enum(clientTools.JOB_STATUSES).optional(),
            location: z.string().max(200).optional(),
            level: z.string().max(200).optional(),
            description: z.string().max(20_000).optional(),
          }),
        },
        (args) =>
          run("create_job", "write", { title: args.title, status: args.status }, async () => {
            const r = await clientTools.createJob(db, ctx, {
              title: args.title, status: args.status, location: args.location, seniority: args.level, description: args.description,
            });
            return { summary: `Created "${r.title}", ${r.status}.`, data: { job_id: r.jobId, title: r.title, status: r.status }, candidateIds: [] };
          }),
      );

      server.registerTool(
        "update_job",
        {
          title: "Update a job",
          description:
            `Changes a job's title, status (${clientTools.JOB_STATUSES.join(", ")}), location, level or ` +
            "description. Only what you pass changes. Needs the right to manage that job. Tell the user what " +
            "will change and wait for a yes.",
          inputSchema: z.object({
            job_id: uuid("job_id"),
            title: z.string().min(1).max(200).optional(),
            status: z.enum(clientTools.JOB_STATUSES).optional(),
            location: z.string().max(200).nullable().optional(),
            level: z.string().max(200).nullable().optional(),
            description: z.string().max(20_000).nullable().optional(),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("update_job", "write", { job_id: args.job_id, status: args.status }, async () => {
            const r = await clientTools.updateJob(db, ctx, {
              jobId: args.job_id, title: args.title, status: args.status,
              location: args.location, seniority: args.level, description: args.description,
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
            "and notes. Filing again replaces yours. Feedback is private to your company's hiring team: " +
            "never put it in a message to the candidate.",
          inputSchema: z.object({
            interview_id: uuid("interview_id"),
            recommendation: z.enum(clientTools.RECOMMENDATIONS),
            rating: z.number().int().min(1).max(4).optional(),
            notes: z.string().min(1).max(10_000),
          }),
        },
        (args) =>
          run("submit_feedback", "write", { interview_id: args.interview_id, recommendation: args.recommendation }, async () => {
            const r = await clientTools.submitFeedback(db, ctx, {
              interviewId: args.interview_id, recommendation: args.recommendation, rating: args.rating, notes: args.notes,
            });
            return {
              summary: r.replaced ? "Your feedback was replaced." : "Feedback filed.",
              data: { feedback_id: r.feedbackId, interview_id: args.interview_id, replaced: r.replaced },
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
            "(application_id), with each interview's interviewers. Whose feedback you can read follows " +
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

      const offerOut = (o: clientTools.Offer) => ({
        offer_id: o.offerId, application_id: o.applicationId, status: o.status,
        salary: o.salary, currency: o.currency, bonus: o.bonus, equity: o.equity,
        start_date: o.startDate, expires_on: o.expiresOn, notes: fence("note", o.notes),
        created_by: o.createdBy, created_at: o.createdAt, extended_at: o.extendedAt, resolved_at: o.resolvedAt,
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
            "extended or closed. Only for the people who manage the job. Compensation is confidential: " +
            "share it only with the user.",
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
            "does not mark them hired: move their stage with update_stage. Tell the user what will change " +
            "and wait for a yes.",
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
    },
    {
      serverInfo: { name: "tacit-client", version: "0.1.0" },
      instructions:
        "Your company's hiring workspace in Tacit: its jobs, the candidates in each job's pipeline, and " +
        "your team. You act as the signed-in member, and Tacit shows and changes only what their access " +
        "allows. Call whoami first. When you only have a name, call search_candidates and use the ids it " +
        "returns. Before update_stage, update_job, set_member_access, invite_member, update_interview, " +
        "create_offer, update_offer, set_interview_plan or removing someone " +
        "from a hiring team, tell the user exactly what will change and wait for a yes. Nothing here " +
        "deletes a candidate or a job. Interview feedback is private to the hiring team: never put it " +
        "in a message to a candidate. Offer terms are confidential: share them only with the user.\n\n" +
        UNTRUSTED_PREAMBLE,
    },
  );
}
