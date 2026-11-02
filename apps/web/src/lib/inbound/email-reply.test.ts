import { describe, expect, test, vi } from "vitest";
import { FakeSupabase } from "../../../../../packages/core/src/test-helpers/fake-supabase";
import { keepReply } from "./email-reply";

const ID = "6f1c2a10-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const MAIL = { providerId: "em_1", from: "Cam <cam@cand.test>", to: [`reply+${ID}@in.tacit.test`], subject: "Re: Hello", text: "Yes please" };
const EMAIL = { data: { id: ID, org_id: "org-1", person_id: "p-1", application_id: "a-1", applications: { roles: { title: "Engineer" } }, subject: "Hello", author_actor_id: "actor-1", status: "sent", people: { display_name: "Cam Lee" } } };
const forwarder = (send = vi.fn(async () => ({ id: "re_1" }))) => ({ send, fromAddress: "hiring@tacit.test" });

describe("keepReply", () => {
  test("mail to any other address touches nothing", async () => {
    const fake = new FakeSupabase([]);
    expect(await keepReply(fake.asDb(), { ...MAIL, to: ["calendar@tacit.test"] }, null)).toBe("not_a_reply");
    expect(fake.calls).toEqual([]);
  });

  test("kept, then forwarded to the author, answering the candidate", async () => {
    const f = forwarder();
    const fake = new FakeSupabase([EMAIL, { data: [{ id: "r-1" }] }, { data: { display_name: "Ada", email: "ada@acme.test" } }]);
    expect(await keepReply(fake.asDb(), MAIL, f)).toBe("forwarded");
    expect(fake.calls[1]).toMatchObject({ table: "candidate_email_replies", args: { email_id: ID, from_email: "cam@cand.test", subject: "Re: Hello", body: "Yes please", provider_id: "em_1" } });
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ from: '"Cam Lee via Tacit" <hiring@tacit.test>', to: "ada@acme.test", replyTo: "cam@cand.test", subject: "Re: Hello", idempotencyKey: "reply-r-1" }));
  });

  test("a second delivery is not forwarded again", async () => {
    const f = forwarder();
    expect(await keepReply(new FakeSupabase([EMAIL, { data: [] }]).asDb(), MAIL, f)).toBe("duplicate");
    expect(f.send).not.toHaveBeenCalled();
  });

  test("a forward that fails keeps the reply and logs no words", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = forwarder(vi.fn(async () => { throw new Error("refused"); }));
    const fake = new FakeSupabase([EMAIL, { data: [{ id: "r-1" }] }, { data: { display_name: "Ada", email: "ada@acme.test" } }]);
    expect(await keepReply(fake.asDb(), MAIL, f)).toBe("kept");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Yes please");
    log.mockRestore();
  });

  test("an author who has left, or no way to send, still keeps it", async () => {
    expect(await keepReply(new FakeSupabase([{ data: { ...EMAIL.data, author_actor_id: null } }, { data: [{ id: "r-1" }] }]).asDb(), MAIL, forwarder())).toBe("kept");
    expect(await keepReply(new FakeSupabase([EMAIL, { data: [{ id: "r-1" }] }, { data: { display_name: "Ada", email: "ada@acme.test" } }]).asDb(), MAIL, null)).toBe("kept");
  });

  test("the bot is told who to ping and what they said, once", async () => {
    const ping = vi.fn(async () => {});
    const reply = () => new FakeSupabase([EMAIL, { data: [{ id: "r-1" }] }, { data: { display_name: "Ada", email: "ada@acme.test" } }]).asDb();
    expect(await keepReply(reply(), MAIL, forwarder(), ping)).toBe("forwarded");
    expect(ping).toHaveBeenCalledWith("org-1", {
      replyId: "r-1", candidateId: "p-1", applicationId: "a-1", candidateName: "Cam Lee", roleTitle: "Engineer", subject: "Re: Hello", body: "Yes please",
      member: { userId: "actor-1", name: "Ada", email: "ada@acme.test" },
    });
    expect(await keepReply(new FakeSupabase([EMAIL, { data: [] }]).asDb(), MAIL, forwarder(), ping)).toBe("duplicate");
    expect(ping).toHaveBeenCalledTimes(1);
  });

  test("a bot that can't be told changes nothing and logs no words", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = new FakeSupabase([EMAIL, { data: [{ id: "r-1" }] }, { data: { display_name: "Ada", email: "ada@acme.test" } }]);
    expect(await keepReply(fake.asDb(), MAIL, forwarder(), async () => { throw new Error("bot refused: http_500"); })).toBe("forwarded");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Yes please");
    log.mockRestore();
  });

  test("a write that fails throws, so the webhook is delivered again", async () => {
    await expect(keepReply(new FakeSupabase([EMAIL, { error: { message: "down" } }]).asDb(), MAIL, null)).rejects.toThrow("down");
  });
});
