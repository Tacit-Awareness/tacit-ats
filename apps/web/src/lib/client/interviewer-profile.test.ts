import { describe, expect, test } from "vitest";
import { clientTools } from "@tacit-ats/core";

import { FOCUS_AREAS_MAX, FOCUS_AREA_MAX, WEEKLY_CAP_MAX, CHANNEL_LABELS, PREFERENCE_LABELS, awayLabel, isAway, loadMeter, profileFromForm } from "./interviewer-profile";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

// Thursday 29 October 2026.
const NOW = new Date("2026-10-29T12:00:00Z");

describe("the limits the client form shows", () => {
  test("are the write's: this file repeats them so the browser does not load core", () => {
    expect(WEEKLY_CAP_MAX).toBe(clientTools.WEEKLY_CAP_MAX);
    expect(FOCUS_AREAS_MAX).toBe(clientTools.FOCUS_AREAS_MAX);
    expect(FOCUS_AREA_MAX).toBe(clientTools.FOCUS_AREA_MAX);
    expect(Object.keys(PREFERENCE_LABELS).sort()).toEqual([...clientTools.INTERVIEW_PREFERENCES].sort());
    expect(Object.keys(CHANNEL_LABELS).sort()).toEqual([...clientTools.INTERVIEW_CHANNELS].sort());
  });
});

describe("profileFromForm", () => {
  test("an empty form is nothing said, not a value", () => {
    expect(clientTools.cleanProfile(profileFromForm(form({})))).toEqual({ preference: null, weeklyCap: null, focusAreas: [], channel: null, awayUntil: null });
    expect(clientTools.cleanProfile(profileFromForm(form({ preference: " ", weeklyCap: "  ", focusAreas: "\n\n", channel: "", awayUntil: "" })))).toMatchObject({ preference: null, weeklyCap: null });
  });

  test("reads every field", () => {
    const profile = profileFromForm(form({ preference: "loves", weeklyCap: " 3 ", focusAreas: "Go\r\nRust\rC\nZig", channel: "imessage", awayUntil: "2026-11-14" }));
    expect(clientTools.cleanProfile(profile)).toEqual({ preference: "loves", weeklyCap: 3, focusAreas: ["Go", "Rust", "C", "Zig"], channel: "imessage", awayUntil: "2026-11-14" });
  });

  test("a comma stays inside an area: one per line is the only separator", () => {
    expect(profileFromForm(form({ focusAreas: "Go, Rust" })).focusAreas).toEqual(["Go, Rust"]);
  });

  test("a limit of 0 is not the same as no limit", () => {
    expect(profileFromForm(form({ weeklyCap: "0" })).weeklyCap).toBe(0);
  });

  test.each(["1e1", "2.5", "-1", "0x10", "three", "9999999999"])("a limit of %s reaches the tool as refused", (weeklyCap) => {
    expect(() => clientTools.cleanProfile(profileFromForm(form({ weeklyCap })))).toThrow(clientTools.ClientToolError);
  });

  test("a file in any field is nothing, not its name", () => {
    const f = new FormData();
    f.set("focusAreas", new File(["x"], "areas.txt"));
    f.set("preference", new File(["x"], "loves"));
    expect(profileFromForm(f)).toMatchObject({ preference: null, focusAreas: [""] });
  });
});

describe("being away", () => {
  test("today is their last day away; yesterday was", () => {
    expect(isAway("2026-10-29", NOW)).toBe(true);
    expect(isAway("2026-10-28", NOW)).toBe(false);
    expect(isAway(null, NOW)).toBe(false);
  });

  test("the day turns in UTC", () => {
    expect(isAway("2026-10-29", new Date("2026-10-29T23:59:59Z"))).toBe(true);
    expect(isAway("2026-10-29", new Date("2026-10-30T00:00:00Z"))).toBe(false);
  });

  test("the label says the date, with a year only when it is not this one", () => {
    expect(awayLabel("2026-11-14", NOW)).toBe("Away through Nov 14");
    expect(awayLabel("2027-01-02", NOW)).toBe("Away through Jan 2, 2027");
    expect(awayLabel("2026-10-28", NOW)).toBeNull();
    expect(awayLabel(null, NOW)).toBeNull();
  });

  test("the first and last days the table holds", () => {
    expect(awayLabel("0001-01-01", NOW)).toBeNull();
    expect(awayLabel("9999-12-31", NOW)).toBe("Away through Dec 31, 9999");
  });
});

describe("the load bar", () => {
  test("with no limit it is the team's busiest week, as it was", () => {
    expect(loadMeter(2, null, 4)).toMatchObject({ pips: 4, lit: 2, label: "2", over: false });
    expect(loadMeter(0, null, 0)).toMatchObject({ pips: 1, lit: 0, label: "0" });
    // past ten pips each stands for more than one, and any interview lights one
    expect(loadMeter(1, null, 40)).toMatchObject({ pips: 10, lit: 1 });
    expect(loadMeter(40, null, 40)).toMatchObject({ pips: 10, lit: 10 });
  });

  test("with a limit the bar is the limit", () => {
    expect(loadMeter(1, 3, 9)).toMatchObject({ pips: 3, lit: 1, label: "1 of 3", over: false });
    expect(loadMeter(3, 3, 9)).toMatchObject({ pips: 3, lit: 3, label: "3 of 3", over: false });
  });

  test("over the limit it says so and stays inside the bar", () => {
    expect(loadMeter(5, 3, 9)).toMatchObject({ pips: 3, lit: 3, label: "5 of 3", over: true });
    expect(loadMeter(5, 3, 9).title).toContain("over their limit");
  });

  test("a limit of 0 divides by nothing", () => {
    expect(loadMeter(0, 0, 3)).toMatchObject({ pips: 0, lit: 0, label: "0 of 0", over: false });
    expect(loadMeter(1, 0, 3)).toMatchObject({ pips: 0, lit: 0, label: "1 of 0", over: true });
  });

  test("a limit past ten pips scales", () => {
    expect(loadMeter(0, 40, 9)).toMatchObject({ pips: 10, lit: 0, label: "0 of 40" });
    expect(loadMeter(1, 40, 9)).toMatchObject({ pips: 10, lit: 1 });
    expect(loadMeter(20, 40, 9)).toMatchObject({ pips: 10, lit: 5 });
    expect(loadMeter(41, 40, 9)).toMatchObject({ pips: 10, lit: 10, over: true });
  });
});
