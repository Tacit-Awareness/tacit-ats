import { describe, expect, test } from "vitest";
import { bookLines, changeLines, conflictLines, doneSentence, names } from "./schedule-copy";

const dana = { userId: "a", name: "Dana" };
const lee = { userId: "b", name: "Lee" };
const sam = { userId: "c", name: "Sam" };

describe("names", () => {
  test("reads as a list", () => {
    expect(names([])).toBe("");
    expect(names(["A"])).toBe("A");
    expect(names(["A", "B"])).toBe("A and B");
    expect(names(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("conflictLines", () => {
  test("says who is busy, and that an unread calendar was not checked", () => {
    expect(conflictLines({ busy: [dana], unknown: [] })).toEqual(["Dana has something else on then."]);
    expect(conflictLines({ busy: [dana, lee], unknown: [] })).toEqual(["Dana and Lee have something else on then."]);
    expect(conflictLines({ busy: [], unknown: [{ ...sam, reason: "not_connected" }] })).toEqual(["Not checked: Sam. Tacit could not read that calendar."]);
    expect(conflictLines({ busy: [], unknown: [] })).toEqual([]);
  });
});

describe("bookLines", () => {
  const invite = { status: "would_invite" as const, organizer: dana, candidateEmail: "pat@x.test", invited: [lee], notInvited: [], meetLink: true };

  test("names the calendar, the guests and the candidate's address", () => {
    expect(bookLines(invite)).toEqual([
      "This goes on Dana's Google Calendar, with a Meet link.",
      "Google emails an invite to Lee and the candidate at pat@x.test.",
    ]);
  });

  test("says when the candidate or an interviewer cannot be invited", () => {
    expect(bookLines({ ...invite, candidateEmail: null, invited: [], notInvited: [sam], meetLink: false })).toEqual([
      "This goes on Dana's Google Calendar.",
      "Google invites nobody else.",
      "The candidate has no usable email on file, so they are not invited.",
      "Sam has no address on file, so is not invited.",
    ]);
  });

  test.each(["not_connected", "not_set_up", "not_asked", "in_the_past", "connection_expired"] as const)("%s says nobody is invited", (reason) => {
    expect(bookLines({ status: "not_sent", reason, connectUrl: null }).join(" ")).toMatch(/nobody is invited/i);
  });
});

describe("changeLines", () => {
  test("a move and a cancel name whose event, and that everyone on it hears", () => {
    expect(changeLines({ status: "would_follow", action: "move", organizer: dana })[0]).toBe("This moves the event on Dana's Google Calendar. Google tells everyone on it, the candidate too.");
    expect(changeLines({ status: "would_follow", action: "cancel", organizer: dana })[0]).toBe("This deletes the event from Dana's Google Calendar. Google tells everyone on it, the candidate too.");
  });

  test("a blocked event says whose, and what the record-only button means", () => {
    expect(changeLines({ status: "blocked", reason: "not_connected", organizer: dana, yours: false }).join(" ")).toMatch(/Dana's calendar, which is not connected.*event stays as it is, and nobody is told/);
    expect(changeLines({ status: "blocked", reason: "not_connected", organizer: dana, yours: true }).join(" ")).toMatch(/on your calendar/);
    expect(changeLines({ status: "blocked", reason: "not_set_up", organizer: null, yours: false }).join(" ")).toMatch(/not set up/);
  });

  test("no event, or one left alone, tells nobody", () => {
    expect(changeLines({ status: "none" })[0]).toMatch(/Nobody is told/);
    expect(changeLines({ status: "left_alone" })[0]).toMatch(/nobody is told/);
  });
});

describe("doneSentence", () => {
  const invited = (candidateInvited: boolean) => ({
    ok: true as const, kind: "booked" as const, interviewId: "i",
    calendar: { status: "invited" as const, organizer: dana, candidateInvited, eventLink: null, meetLink: null, invited: [lee], notInvited: [] },
  });

  test("never claims more than happened", () => {
    expect(doneSentence(invited(true))).toBe("Booked on Dana's calendar. Google invited the candidate and the interviewers.");
    expect(doneSentence(invited(false))).toMatch(/no usable email/);
    expect(doneSentence({ ok: true, kind: "booked", interviewId: "i", calendar: { status: "not_sent", reason: "not_connected", connectUrl: null } })).toBe("Booked in Tacit only. Nobody was invited.");
    expect(doneSentence({ ok: true, kind: "changed", op: "move", calendar: "moved" })).toMatch(/Google told everyone/);
    expect(doneSentence({ ok: true, kind: "changed", op: "cancel", calendar: "cancelled" })).toMatch(/Google told everyone/);
    expect(doneSentence({ ok: true, kind: "changed", op: "cancel", calendar: "already_gone" })).toBe("Cancelled. Its calendar event was already gone.");
    expect(doneSentence({ ok: true, kind: "changed", op: "move", calendar: "left_alone" })).toBe("Moved in Tacit only. The calendar event stays as it is.");
    expect(doneSentence({ ok: true, kind: "changed", op: "cancel", calendar: "none" })).toBe("Cancelled in Tacit. It was not on a calendar.");
    expect(doneSentence({ ok: true, kind: "unchanged" })).toMatch(/Nothing changed/);
  });
});
