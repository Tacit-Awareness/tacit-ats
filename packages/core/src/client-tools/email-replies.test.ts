import { describe, expect, test } from "vitest";
import { REPLY_BODY_MAX, addressOf, parseReplyDomain, readableReply, repliedEmailId, replyAddress } from "./email-replies.js";

const ID = "6f1c2a10-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("the reply address", () => {
  test("is found again however a mail system writes it", () => {
    const address = replyAddress(ID, "in.tacit.test");
    for (const to of [address, address.toUpperCase(), `Ada at Acme <${address}>`, `"Ada" <${address}>`]) expect(repliedEmailId([to])).toBe(ID);
    expect(repliedEmailId(["someone@x.test", address])).toBe(ID);
  });

  test("anything else is no reply", () => {
    for (const to of ["calendar@tacitawareness.com", "reply@x.test", "reply+nope@x.test", `notreply+${ID}@x.test`]) expect(repliedEmailId([to])).toBeNull();
    expect(repliedEmailId([])).toBeNull();
  });

  test("the domain is a domain or nothing", () => {
    expect(parseReplyDomain(" In.Tacit.Test ")).toBe("in.tacit.test");
    for (const v of [undefined, "", "nodots", "a b.test", "x@y.test"]) expect(parseReplyDomain(v)).toBeNull();
  });
});

describe("what is kept of an email", () => {
  test("the sender's bare address", () => {
    expect(addressOf("Cam Lee <Cam@Cand.Test>")).toBe("cam@cand.test");
    expect(addressOf(" cam@cand.test ")).toBe("cam@cand.test");
  });

  test("text as it came, an html-only email as text with its markup gone", () => {
    expect(readableReply({ subject: "Re: Hi", text: "Yes\r\nThanks\r\n", html: "<p>ignored</p>" })).toEqual({ subject: "Re: Hi", body: "Yes\nThanks" });
    expect(readableReply({ html: '<style>p{}</style><script>x()</script><p>Tom &amp; Jo</p><img src=x onerror=y>Hi<br>there' }).body).toBe("Tom & Jo\nHi\nthere");
  });

  test("what the table can't hold doesn't stop it", () => {
    const r = readableReply({ subject: `a\r\nb${"x".repeat(400)}`, text: `\0ok\uD83D${"y".repeat(30_000)}` });
    expect(r.subject).toHaveLength(300);
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect(r.body.startsWith("oky")).toBe(true);
    expect(r.body.length).toBeLessThanOrEqual(REPLY_BODY_MAX);
  });

  test("nothing at all is still a reply", () => {
    expect(readableReply({})).toEqual({ subject: "", body: "" });
  });
});
