import { describe, expect, test } from "vitest";
import { NOT_BOOKED, age, commandsFor, isCommand, kindLabel, roundOf, roundOrder, standing, statusOf, stepsOf } from "./bot-task-rules";

describe("statusOf", () => {
  test("an open task the bot flagged needs you", () => {
    expect(statusOf({ status: "waiting", needsYou: true })).toBe("needs");
    expect(statusOf({ status: "running", needsYou: true })).toBe("needs");
  });
  test("otherwise its own status, a failed or closed one included", () => {
    expect(statusOf({ status: "failed", needsYou: true })).toBe("failed");
    expect(statusOf({ status: "done", needsYou: true })).toBe("done");
    expect(statusOf({ status: "waiting", needsYou: false })).toBe("waiting");
  });
});

test("commands: retry a failure, nudge a wait, cancel anything open, nothing on a closed task", () => {
  expect(commandsFor("failed")).toEqual(["retry", "cancel"]);
  expect(commandsFor("waiting")).toEqual(["nudge", "cancel"]);
  expect(commandsFor("running")).toEqual(["cancel"]);
  expect(commandsFor("done")).toEqual([]);
  expect(isCommand("nudge")).toBe(true);
  expect(isCommand("send_invite")).toBe(false);
  expect(isCommand("drop table")).toBe(false);
});

test("stepsOf keeps labelled steps only", () => {
  expect(stepsOf([{ label: " Asked Lee " }, { label: "" }, 3, null, { label: "Booked", at: "2026-11-19T10:00:00Z" }])).toEqual([
    { label: "Asked Lee", at: null },
    { label: "Booked", at: "2026-11-19T10:00:00Z" },
  ]);
  expect(stepsOf("nope")).toEqual([]);
});

test("standing: the error, who it waits on and where, else the last step", () => {
  const base = { error: null, waitingOn: null, waitingChannel: null, steps: [{ label: "Found a slot", at: null }] };
  expect(standing({ ...base, status: "failed", error: "Calendar not connected" })).toBe("Calendar not connected");
  expect(standing({ ...base, status: "waiting", waitingOn: "Lee", waitingChannel: "slack" })).toBe("Lee on Slack");
  expect(standing({ ...base, status: "running" })).toBe("Found a slot");
});

test("kindLabel names every kind, and anything new as Other", () => {
  expect(kindLabel("schedule_interview")).toBe("Schedule Interview");
  expect(kindLabel("brand_new")).toBe("Other");
});

describe("rounds", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const iv = (step: string | null, startH: number, status = "scheduled") => ({ step, status, startsAt: new Date(now + startH * 3_600_000).toISOString(), endsAt: new Date(now + (startH + 1) * 3_600_000).toISOString() });
  test("the next booked interview's step wins, then the last held, else not booked", () => {
    expect(roundOf([iv("Screen", -48), iv("Onsite", 24)], now)).toBe("Onsite");
    expect(roundOf([iv("Screen", -48), iv("Tech", -24)], now)).toBe("Tech");
    expect(roundOf([], now)).toBe(NOT_BOOKED);
    expect(roundOf([iv(null, 5)], now)).toBe("Interview");
  });
  test("ordered: not booked, then the process's order, then the rest by name", () => {
    expect(roundOrder(["Onsite", "Zeta", NOT_BOOKED, "Screen", "Alpha", "Onsite"], ["Screen", "Onsite"])).toEqual([NOT_BOOKED, "Screen", "Onsite", "Alpha", "Zeta"]);
    expect(roundOrder(["b", "a"], null)).toEqual(["a", "b"]);
  });
});

test("age", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  expect(age("2026-11-19T11:58:00Z", now)).toBe("2m");
  expect(age("2026-11-19T09:00:00Z", now)).toBe("3h");
  expect(age("2026-11-16T12:00:00Z", now)).toBe("3d");
  expect(age("2026-10-01T12:00:00Z", now)).toBe("7w");
});
