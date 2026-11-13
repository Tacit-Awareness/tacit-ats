import { describe, expect, test } from "vitest";
import { clock12, forWord12, whenWord12 } from "./local-time";

// The Inbox's times on a 12-hour clock, as Hy asked: "6:40 PM", "10 AM".

describe("the Inbox's clock", () => {
  test("is 12-hour, with the minutes only when there are any", () => {
    expect(clock12(18 * 60 + 40)).toBe("6:40 PM");
    expect(clock12(10 * 60)).toBe("10 AM");
    expect(clock12(9 * 60 + 5)).toBe("9:05 AM");
    expect(clock12(0)).toBe("12 AM");
    expect(clock12(12 * 60)).toBe("12 PM");
  });

  const now = Date.parse("2026-11-12T20:00:00Z");
  test("says the time today, the weekday this past week, else the day", () => {
    expect(whenWord12("2026-11-12T18:40:00Z", now, "UTC")).toBe("6:40 PM");
    expect(whenWord12("2026-11-11T18:40:00Z", now, "UTC")).toBe("Wed 6:40 PM");
    expect(whenWord12("2026-10-03T10:00:00Z", now, "UTC")).toBe("Oct 3 10 AM");
  });

  test('and what follows "for" in a sentence', () => {
    expect(forWord12("2026-11-13T14:00:00Z", now, "UTC")).toBe("tomorrow 2 PM");
  });
});
