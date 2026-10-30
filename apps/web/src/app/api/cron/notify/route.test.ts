import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const core = vi.hoisted(() => ({ runNotifications: vi.fn() }));
const notifier = vi.hoisted(() => ({
  notifierDb: () => ({ fake: "db" }),
  companiesWithBots: vi.fn(),
  companyCalendar: vi.fn(() => ({ clientId: "cid", clientSecret: "secret" })),
  companyHub: vi.fn((d: { orgId: string }) => ({ orgId: d.orgId, adapters: [], testbenchUrl: null })),
}));
const workflow = vi.hoisted(() => ({ start: vi.fn(async () => ({ runId: "wrun_1" })) }));
vi.mock("@tacit/core", () => core);
vi.mock("@/lib/notify/notifier", () => notifier);
vi.mock("workflow/api", () => workflow);
vi.mock("@/workflows/interview-reminder", () => ({ interviewReminderTimer: "timer" }));

import { GET } from "./route";

const ACME = "0a000000-0000-4000-8000-00000000000a";
const BETA = "0b000000-0000-4000-8000-00000000000b";
const call = (auth: string | null = "Bearer cron") =>
  GET(new Request("https://ats.test/api/cron/notify", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron");
  notifier.companiesWithBots.mockReset().mockResolvedValue([{ orgId: ACME }, { orgId: BETA }]);
  core.runNotifications.mockReset().mockResolvedValue({ deliveries: { sent: 1 } });
  workflow.start.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/notify", () => {
  test("refuses without the cron secret, and when none is configured", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(core.runNotifications).not.toHaveBeenCalled();
  });

  test("one tick per company with a bot, each for that company only", async () => {
    const res = await call();
    expect(await res.json()).toMatchObject({ status: "ok", companies: 2, results: [{ orgId: ACME, status: "ok" }, { orgId: BETA, status: "ok" }] });
    expect(core.runNotifications.mock.calls.map((c) => c[1].orgId)).toEqual([ACME, BETA]);
    const deps = core.runNotifications.mock.calls[0][1];
    expect(deps).toMatchObject({ testbenchSource: null, calendarSync: { calendar: { clientId: "cid" } } });
    // Members' Retry and Nudge go out, and to that company's bot alone: no override of who receives them.
    expect(deps.botTasks).toEqual({});

    // A timer is started for that company's interview.
    expect(await deps.reminderTimers.start({ interviewId: "iv", startsAt: "s", wakeAt: "w" })).toBe("wrun_1");
    expect(workflow.start).toHaveBeenCalledWith("timer", [ACME, "iv", "s", "w"]);
  });

  test("one company failing does not stop the next", async () => {
    core.runNotifications.mockRejectedValueOnce(new Error("boom"));
    const res = await call();
    expect(await res.json()).toMatchObject({ results: [{ orgId: ACME, status: "failed" }, { orgId: BETA, status: "ok" }] });
  });

  test("NOTIFY_REMINDER_TIMERS=off: no timers, the tick's own reminder only", async () => {
    vi.stubEnv("NOTIFY_REMINDER_TIMERS", "off");
    await call();
    expect(core.runNotifications.mock.calls[0][1].reminderTimers).toBeNull();
  });
});
