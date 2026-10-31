import { describe, expect, test } from "vitest";
import { INBOX_NOTICES, movedToast, type InboxNotice } from "./messages";

describe("the toast after acting in the pop-up", () => {
  test("says who left and who is next", () => {
    expect(movedToast("dismissed", { name: "Ada", next: "Lin", caughtUp: false })).toBe("Ada moved to Done. Next: Lin.");
    expect(movedToast("touched", { name: "Ada", next: "Lin", caughtUp: false })).toBe("Ada moved to Done. Next: Lin.");
  });

  test("says when that was the last", () => {
    expect(movedToast("sent", { name: "Ada", next: null, caughtUp: true })).toBe("Ada moved to Done. You're all caught up.");
  });

  test("never claims caught up with others still waiting", () => {
    expect(movedToast("done", { name: "Ada", next: null, caughtUp: false })).toBe("Ada moved to Done.");
  });

  test("a decision keeps what it has to say about what did not happen", () => {
    expect(movedToast("moved_offer", { name: "Ada", next: "Lin", caughtUp: false })).toBe("Moved to offer. No offer has been drafted or sent. Ada moved to Done. Next: Lin.");
    expect(movedToast("closed", { name: "Ada", next: null, caughtUp: true })).toBe("Rejected. No email went out. Ada moved to Done. You're all caught up.");
  });

  test("a name the member can't read is no name", () => {
    expect(movedToast("dismissed", { name: null, next: null, caughtUp: true })).toBe("That moved to Done. You're all caught up.");
  });

  test("what left nothing keeps its own sentence", () => {
    for (const notice of ["unchanged", "already_decided", "approval_reset", "restored", "read", "all_read"] satisfies InboxNotice[]) {
      expect(movedToast(notice, { name: "Ada", next: "Lin", caughtUp: false })).toBeNull();
      expect(INBOX_NOTICES[notice]).toBeTruthy();
    }
  });
});
