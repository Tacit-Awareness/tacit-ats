import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Refusal, type RefusalReason } from "./refusal";

// A refused sign-in renders with no sidebar, whose sign-out it would otherwise
// use, and signing out is a POST, so no URL can do it for them.

test.each<RefusalReason>(["not_invited", "email_unverified", "subject_mismatch", "token_rejected"])(
  "%s offers a way out of the session",
  (reason) => {
    const html = renderToStaticMarkup(<Refusal reason={reason} />);
    expect(html).toContain('action="/client/signout"');
    expect(html).toContain('method="post"');
  },
);

test("signed out still offers Sign out: the cookie can outlive the account (deleted since), and this clears it", () => {
  expect(renderToStaticMarkup(<Refusal reason="signed_out" />)).toContain("/client/signout");
});
