import { beforeEach, describe, expect, test, vi } from "vitest";

// Settings > Email templates' two actions by hand, as anyone can call them by
// id: the fields tampered with, the session gone, a member who isn't an admin,
// a write failing. The writes are mocked. A template's words never reach the
// URL or the log.

const session = vi.hoisted(() => ({ requireClient: vi.fn() }));
const templates = vi.hoisted(() => ({ saveTemplate: vi.fn(), archiveTemplate: vi.fn() }));
const redirected = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("@/lib/client/session", () => session);
vi.mock("@/lib/client/email-templates", () => templates);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected.to.push(to);
    throw new Error("NEXT_REDIRECT");
  },
}));

import { archiveTemplateAction, saveTemplateAction } from "./actions";

const TEMPLATE = "55555555-5555-4555-8555-555555555555";
const WORDS = "Our offer is 200k, do not forward";
const ctx = { actorId: "a", orgId: "o", accessLevel: "admin", source: "dashboard" };
const member = (accessLevel = "admin") => ({ db: {}, actorId: "a", accessLevel, org: { id: "o" } });

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const good = { name: "Intro", subject: "Secret subject", body: WORDS };

beforeEach(() => {
  vi.clearAllMocks();
  redirected.to.length = 0;
  session.requireClient.mockResolvedValue(member());
  templates.saveTemplate.mockResolvedValue({ ok: true, changed: true });
  templates.archiveTemplate.mockResolvedValue({ ok: true, changed: true });
});

const lastUrl = () => new URL(redirected.to.at(-1)!, "http://x");

describe("saveTemplateAction", () => {
  test("nothing happens without a session", async () => {
    session.requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(saveTemplateAction({}, form(good))).rejects.toThrow("unauthenticated");
    expect(templates.saveTemplate).not.toHaveBeenCalled();
  });

  test("a new one is made on the member's own client as dashboard, and the URL carries a code only", async () => {
    await expect(saveTemplateAction({}, form(good))).rejects.toThrow("NEXT_REDIRECT");
    expect(templates.saveTemplate).toHaveBeenCalledWith({}, ctx, { templateId: null, ...good });
    expect(redirected.to).toEqual(["/client/settings/templates?notice=created"]);
  });

  test("an existing one is saved by id; unchanged says so", async () => {
    templates.saveTemplate.mockResolvedValue({ ok: true, changed: false });
    await expect(saveTemplateAction({}, form({ ...good, templateId: TEMPLATE }))).rejects.toThrow("NEXT_REDIRECT");
    expect(templates.saveTemplate).toHaveBeenCalledWith({}, ctx, { templateId: TEMPLATE, ...good });
    expect(lastUrl().searchParams.get("notice")).toBe("unchanged");
  });

  test.each(["recruiter", "limited"])("a %s writes nothing", async (level) => {
    session.requireClient.mockResolvedValue(member(level));
    expect(await saveTemplateAction({}, form(good))).toEqual({ error: expect.stringContaining("admin") });
    expect(templates.saveTemplate).not.toHaveBeenCalled();
  });

  test.each([
    ["no name", { ...good, name: "" }],
    ["no body", { name: "Intro", subject: "S" }],
    ["a tampered id", { ...good, templateId: "x' or 1=1" }],
  ])("%s writes nothing", async (_, fields) => {
    expect(await saveTemplateAction({}, form(fields as Record<string, string>))).toEqual({ error: expect.any(String) });
    expect(templates.saveTemplate).not.toHaveBeenCalled();
  });

  test("core's refusal stays on the form, not in a URL", async () => {
    templates.saveTemplate.mockResolvedValue({ ok: false, error: "A template by that name already exists. Change that one instead." });
    expect(await saveTemplateAction({}, form(good))).toEqual({ error: "A template by that name already exists. Change that one instead." });
    expect(redirected.to).toEqual([]);
  });

  test("a failed write says so, and the words stay out of the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    templates.saveTemplate.mockRejectedValue(new Error("connection reset"));
    expect(await saveTemplateAction({}, form(good))).toEqual({ error: expect.stringContaining("Nothing was saved") });
    expect(JSON.stringify(log.mock.calls)).not.toContain(WORDS);
    expect(JSON.stringify(log.mock.calls)).not.toContain("Secret subject");
    log.mockRestore();
  });
});

describe("archiveTemplateAction", () => {
  const post = async (fields: Record<string, string>) => {
    await expect(archiveTemplateAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
    return lastUrl();
  };

  test("nothing happens without a session", async () => {
    session.requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(archiveTemplateAction(form({ templateId: TEMPLATE, archived: "true" }))).rejects.toThrow("unauthenticated");
    expect(templates.archiveTemplate).not.toHaveBeenCalled();
  });

  test("archives and brings back, by id", async () => {
    expect((await post({ templateId: TEMPLATE, archived: "true" })).searchParams.get("notice")).toBe("archived");
    expect(templates.archiveTemplate).toHaveBeenLastCalledWith({}, ctx, { templateId: TEMPLATE, archived: true });
    expect((await post({ templateId: TEMPLATE, archived: "false" })).searchParams.get("notice")).toBe("restored");
    expect(templates.archiveTemplate).toHaveBeenLastCalledWith({}, ctx, { templateId: TEMPLATE, archived: false });
  });

  test("a tampered form changes nothing", async () => {
    expect((await post({ templateId: "Intro", archived: "true" })).searchParams.get("error")).toBe("gone");
    expect(templates.archiveTemplate).not.toHaveBeenCalled();
  });

  test("anyone but an admin is told so", async () => {
    session.requireClient.mockResolvedValue(member("hiring_manager"));
    expect((await post({ templateId: TEMPLATE, archived: "true" })).searchParams.get("error")).toBe("forbidden");
    expect(templates.archiveTemplate).not.toHaveBeenCalled();
  });

  test("core's refusals are codes", async () => {
    templates.archiveTemplate.mockResolvedValue({ ok: false, error: "That template isn't there any more. Reload to see the current ones." });
    expect((await post({ templateId: TEMPLATE, archived: "true" })).searchParams.get("error")).toBe("gone");
    templates.archiveTemplate.mockResolvedValue({ ok: false, error: "Only an admin at your company makes or changes email templates." });
    expect((await post({ templateId: TEMPLATE, archived: "true" })).searchParams.get("error")).toBe("forbidden");
  });

  test("a failure says so", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    templates.archiveTemplate.mockRejectedValue(new Error("connection reset"));
    expect((await post({ templateId: TEMPLATE, archived: "true" })).searchParams.get("error")).toBe("failed");
    log.mockRestore();
  });
});
