import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// What the box draws in each state, to markup. The actions are stubs: nothing
// here writes or sends.

vi.mock("./actions", () => ({ draftReplyAction: vi.fn(), sendReplyAction: vi.fn() }));

import { ReplyBox, type Reply } from "./reply-box";

const reply = (over: Partial<Reply> = {}): Reply => ({
  applicationId: "a1",
  candidateId: "p1",
  to: "nia@x.test",
  enabled: true,
  draft: null,
  sender: { from: '"Ada at Acme" <hiring@example.test>', replyTo: "ada@acme.test" },
  failed: null,
  sent: null,
  starters: { subject: "Your application", bodies: { interview: "Hi Nia, meet us", decline: "Hi Nia, no", blank: "Hi Nia," }, testbench: "Hi Nia, try it" },
  subjectMax: 300,
  bodyMax: 20000,
  ...over,
});
const html = (over: Partial<Reply> = {}) => renderToStaticMarkup(<ReplyBox reply={reply(over)} />);

describe("the reply box", () => {
  test("with no mailer it says so, and Reply is off", () => {
    const out = html({ enabled: false });
    expect(out).toContain("Email isn&#x27;t set up on this deployment");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Reply/);
    expect(out).not.toContain("Review draft");
  });

  test("with no address it says so, and Reply is off", () => {
    const out = html({ to: null });
    expect(out).toContain("No email address on file");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Reply/);
  });

  test("a stored draft is shown whole, From, To, subject and body, over a Send", () => {
    const out = html({ draft: { draftId: "d1", to: "nia@x.test", subject: "Stored subject", body: "Stored body\n\nline two" } });
    for (const part of ["hiring@example.test", "ada@acme.test", "nia@x.test", "Stored subject", "Stored body", "line two"]) expect(out).toContain(part);
    expect(out).toMatch(/type="hidden" name="draftId" value="d1"/);
    expect(out).toContain(">Send<");
    expect(out).toContain("Change it");
    expect(out).toContain("Nothing has gone out");
  });

  test("a draft is text: markup in it is never markup", () => {
    const out = html({ draft: { draftId: "d1", to: "nia@x.test", subject: "<b>x</b>", body: "<img src=x onerror=alert(1)>" } });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  test("no Send until there is a draft", () => {
    const out = html();
    expect(out).not.toContain(">Send<");
    expect(out).toContain("Nothing goes out until you read the draft");
  });

  test("before anyone edits, the reply is a preview, and Review draft posts exactly what it shows", () => {
    const out = html();
    expect(out).toContain("Hi Nia, meet us");
    expect(out).toContain("To nia@x.test");
    expect(out).toMatch(/type="hidden" name="subject" value="Your application"/);
    expect(out).toMatch(/type="hidden" name="body" value="Hi Nia, meet us"/);
    expect(out).toContain("Review draft");
    expect(out).not.toContain("<textarea");
  });

  test("the preview starts from the suggested starter", () => {
    const out = renderToStaticMarkup(<ReplyBox reply={reply()} suggested="decline" />);
    expect(out).toMatch(/type="hidden" name="body" value="Hi Nia, no"/);
    expect(out).not.toContain("Hi Nia, meet us");
  });

  test("the preview is text: markup in a starter is never markup", () => {
    const out = html({ starters: { subject: "s", bodies: { interview: "<img src=x onerror=alert(1)>", decline: "d", blank: "b" }, testbench: "t" } });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  test("an email already sent is said before anyone replies again", () => {
    expect(html({ sent: { when: "today", subject: "Hello", by: "Lee Lead" } })).toContain("Lee Lead emailed them today: Hello");
  });

  test("that is said over a stored draft too", () => {
    const out = html({ sent: { when: "today", subject: "Hello", by: "Lee Lead" }, draft: { draftId: "d1", to: "nia@x.test", subject: "s", body: "b" } });
    expect(out).toContain("Lee Lead emailed them today: Hello");
    expect(out).toContain(">Send<");
  });

  test("a failed send comes back open on its own words", () => {
    const out = html({ failed: { subject: "Kept subject", body: "Kept body" } });
    expect(out).toContain("Kept subject");
    expect(out).toContain("Kept body");
    expect(out).toContain("Review draft");
  });

  test("and says why it is open: it may be a visit long after the send failed", () => {
    expect(html({ failed: { subject: "Kept subject", body: "Kept body" } })).toContain("didn&#x27;t go out");
    expect(html()).not.toContain("didn&#x27;t go out");
  });
});
