import { describe, expect, it } from "vitest";

// Relative and without ".js": see apps/mcp/CLAUDE.md.
import { CONFIRM_ALSO, needsConfirm } from "../../cli/src/guide";
import { buildClientHandler } from "./client/server";

/**
 * tats (apps/cli) cannot show a model the connector's instructions the way
 * Claude does, so it refuses to run, without --yes, every tool those
 * instructions say to confirm first: each destructiveHint tool, plus the few
 * in its CONFIRM_ALSO. This fails when the instructions name a tool to
 * confirm that tats would run unasked, so the two cannot drift apart.
 */

// Named in the instructions, but not as something to confirm.
const MENTIONED_NOT_CONFIRMED = new Set(["whoami", "search_candidates", "draft_email", "eeoc_report"]);

async function connector() {
  const member = { actorId: "a", orgId: "o", accessLevel: "admin", db: {}, subject: "s", workosOrgId: "w" } as never;
  const handler = buildClientHandler(member, "claude", {
    audit: async () => {}, breadth: async () => false, invitations: null, files: null, email: null,
  });
  const rpc = async (method: string, params: Record<string, unknown>) => {
    const res = await handler(new Request("http://x/api/client", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }));
    const line = (await res.text()).split("\n").find((l) => l.startsWith("data: "))!;
    return JSON.parse(line.slice("data: ".length)).result;
  };
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  const { tools } = await rpc("tools/list", {});
  return { instructions: init.instructions as string, tools: tools as { name: string; annotations?: { destructiveHint?: boolean } }[] };
}

describe("tats's --yes list against the connector's instructions", () => {
  it("asks for --yes before every tool the instructions say to confirm", async () => {
    const { instructions, tools } = await connector();
    const named = tools.filter((t) => new RegExp(`\\b${t.name}\\b`).test(instructions) && !MENTIONED_NOT_CONFIRMED.has(t.name));
    expect(named.length).toBeGreaterThan(20);
    expect(named.filter((t) => !needsConfirm(t)).map((t) => t.name)).toEqual([]);
  });

  it("lists in CONFIRM_ALSO only real tools that are not already destructive", async () => {
    const { tools } = await connector();
    for (const name of CONFIRM_ALSO) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.annotations?.destructiveHint, name).not.toBe(true);
    }
  });
});
