import { describe, expect, test } from "vitest";
import { MailboxConnectError, exchangeMailboxCode, mailboxConsentUrl } from "./google-mailbox";

const CONFIG = { clientId: "cid", clientSecret: "cs" };
const SEND = "https://www.googleapis.com/auth/gmail.send";
const READ = "https://www.googleapis.com/auth/gmail.readonly";
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email, email_verified: true })).toString("base64url")}.y`;
const google = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("connecting Gmail", () => {
  test("asks to send and to read, offline, every time", () => {
    const url = new URL(mailboxConsentUrl(CONFIG, "https://ats.test/client/mailbox/callback", "st", "ada@acme.test"));
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(["openid", "email", SEND, READ]);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  test("a grant that may send and read", async () => {
    const grant = await exchangeMailboxCode(CONFIG, "r", "c", google({ refresh_token: "rt", scope: `openid ${SEND} ${READ}`, id_token: idToken("Ada@Acme.test") }));
    expect(grant).toEqual({ refreshToken: "rt", accountEmail: "ada@acme.test", scopes: `openid ${SEND} ${READ}`, readsReplies: true });
  });

  test("reading unticked is still a connection, for sending only", async () => {
    const grant = await exchangeMailboxCode(CONFIG, "r", "c", google({ refresh_token: "rt", scope: `openid ${SEND}`, id_token: idToken("ada@acme.test") }));
    expect(grant.readsReplies).toBe(false);
  });

  test("refused without sending, a refresh token or an account", async () => {
    const code = (body: unknown, status?: number) =>
      exchangeMailboxCode(CONFIG, "r", "c", google(body, status)).then(() => null, (e: MailboxConnectError) => e.code);
    expect(await code({ refresh_token: "rt", scope: READ, id_token: idToken("a@b.test") })).toBe("missing_scopes");
    expect(await code({ scope: SEND, id_token: idToken("a@b.test") })).toBe("no_refresh_token");
    expect(await code({ refresh_token: "rt", scope: SEND })).toBe("no_email");
    expect(await code({ error: "invalid_grant" }, 400)).toBe("exchange_failed");
  });
});
