import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { APPLICATION_STAGES, UNTRUSTED_PREAMBLE, clientTools, wrapUntrusted } from "@tacit/core";

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
            "next action) and the team's notes. An interviewer gets the name, headline and LinkedIn of " +
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
            "stage back. Tell the user what will change and wait for a yes before calling this.",
          inputSchema: z.object({
            application_id: uuid("application_id"),
            stage: z.enum(APPLICATION_STAGES),
            expected_stage: z.enum(APPLICATION_STAGES).optional(),
          }),
          annotations: { destructiveHint: true },
        },
        (args) =>
          run("update_stage", "write", args, async () => {
            const r = await clientTools.updateStage(db, ctx, {
              applicationId: args.application_id, stage: args.stage, expectedStage: args.expected_stage,
            });
            const summary = {
              moved: `Moved to ${r.stage}.`,
              unchanged: `Already at ${r.stage}. Nothing changed.`,
              changed_since: `Not moved: someone changed it since; it is at ${r.stage} now. Ask the user again.`,
            }[r.outcome];
            return { summary, data: { outcome: r.outcome, application_id: args.application_id, stage: r.stage }, candidateIds: [] };
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
    },
    {
      serverInfo: { name: "tacit-client", version: "0.1.0" },
      instructions:
        "Your company's hiring workspace in Tacit: its jobs, the candidates in each job's pipeline, and " +
        "your team. You act as the signed-in member, and Tacit shows and changes only what their access " +
        "allows. Call whoami first. When you only have a name, call search_candidates and use the ids it " +
        "returns. Before update_stage, tell the user exactly what will change and wait for a yes. Nothing " +
        "here deletes anything.\n\n" +
        UNTRUSTED_PREAMBLE,
    },
  );
}
