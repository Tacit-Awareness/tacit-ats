import { afterEach, describe, expect, test, vi } from "vitest";
import { signAgentWebhook } from "@tacit/core";
import type { Db } from "@tacit/db";

const destinations = vi.hoisted(() => vi.fn());
vi.mock("@tacit/core", async (real) => ({ ...(await real<typeof import("@tacit/core")>()), listAgentDestinations: destinations }));

import { candidateRepliedEvent, pingCompanyBot, type CandidateReply } from "./candidate-replied";

const REPLY: CandidateReply = {
  replyId: "r-1", candidateId: "p-1", applicationId: "a-1", candidateName: "Cam Lee", roleTitle: "Engineer", subject: "Re: Hello",
  body: "im available today at 5pm or 7pm", member: { userId: "act-1", name: "Ada", email: "ada@acme.test" },
};
const BOT = { orgId: "org-1", channel: "grok_bot_webhook", url: "https://bot.test/hook", secret: "key", verifiedAt: "2026-10-01T00:00:00Z" };
const db = {} as Db;
const ORIGIN = "https://ats.test";
const answer = (status: number) => vi.fn(async () => new Response(null, { status }));

afterEach(() => vi.unstubAllGlobals());

describe("the candidate.replied event", () => {
  test("says who it is for and what they said, fenced, with a link to it", () => {
    const e = candidateRepliedEvent(REPLY, ORIGIN);
    expect(e).toMatchObject({ event: "candidate.replied", eventId: "evt_reply_r-1", member: REPLY.member, text: "Cam Lee replied to your email about Engineer.", inboxUrl: "https://ats.test/client/inbox?i=reply-r-1" });
    expect(e.reply).toContain("today at 5pm or 7pm");
    expect(e.reply).not.toBe(REPLY.body);
  });

  test("a long reply is cut", () => {
    expect(candidateRepliedEvent({ ...REPLY, body: "x".repeat(50_000) }, ORIGIN).reply.length).toBeLessThan(5_000);
  });
});

describe("pingCompanyBot", () => {
  test("posts signed, as the interview events are", async () => {
    destinations.mockResolvedValue([BOT]);
    const post = answer(200);
    vi.stubGlobal("fetch", post);
    await pingCompanyBot(db, "org-1", REPLY, ORIGIN);
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(BOT.url);
    expect(init.headers).toMatchObject({ authorization: "Bearer key", "x-tacit-event": "candidate.replied", "x-tacit-event-id": "evt_reply_r-1" });
    expect(init.headers["x-tacit-signature"]).toBe(await signAgentWebhook("key", init.headers["x-tacit-timestamp"]!, init.body as string));
    expect(init.redirect).toBe("manual");
  });

  test("no bot, an unverified one or another company's is told nothing", async () => {
    const post = answer(200);
    vi.stubGlobal("fetch", post);
    for (const list of [[], [{ ...BOT, verifiedAt: null }], [{ ...BOT, orgId: "org-2" }]]) {
      destinations.mockResolvedValue(list);
      await pingCompanyBot(db, "org-1", REPLY, ORIGIN);
    }
    expect(post).not.toHaveBeenCalled();
  });

  test("a refusal is tried once more, with the same event id, then said", async () => {
    destinations.mockResolvedValue([BOT]);
    const post = answer(500);
    vi.stubGlobal("fetch", post);
    await expect(pingCompanyBot(db, "org-1", REPLY, ORIGIN)).rejects.toThrow("http_500");
    expect(post).toHaveBeenCalledTimes(2);
  });
});
