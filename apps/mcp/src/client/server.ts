import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { UNTRUSTED_PREAMBLE } from "@tacit/core";

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
};

const LEVELS = { limited: "interviewer", elevated: "hiring team", admin: "admin" } as const;

export function buildClientHandler(member: ClientMember, deps: ClientHandlerDeps) {
  async function run(tool: string, args: unknown, fn: () => Promise<Outcome>) {
    try {
      const out = await fn();
      await deps.audit({ actorId: member.actorId, tool, args, personIds: out.candidateIds, ok: true });
      return {
        content: [{ type: "text" as const, text: `${out.summary}\n\n${JSON.stringify(out.data)}` }],
        structuredContent: out.data,
      };
    } catch (err) {
      await deps.audit({ actorId: member.actorId, tool, args, personIds: [], ok: false });
      console.error(`[client-mcp] ${tool} failed`, err);
      return { content: [{ type: "text" as const, text: "Something went wrong on the Tacit side. Try again." }], isError: true };
    }
  }

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
          run("whoami", args, async () => {
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
    },
    {
      serverInfo: { name: "tacit-client", version: "0.1.0" },
      instructions:
        "Your company's hiring workspace in Tacit: its jobs, the candidates in each job's pipeline, and " +
        "your team. You act as the signed-in member, and Tacit shows and changes only what their access " +
        "allows. Call whoami first.\n\n" +
        UNTRUSTED_PREAMBLE,
    },
  );
}
