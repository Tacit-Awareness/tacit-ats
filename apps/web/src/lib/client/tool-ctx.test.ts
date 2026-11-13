import { describe, expect, test } from "vitest";
import { toolCtx } from "./tool-ctx";

describe("toolCtx", () => {
  test("is the member, labelled as the web app, with nothing else of the session", () => {
    const member = {
      db: {},
      actorId: "actor-1",
      accessLevel: "elevated" as const,
      org: { id: "org-1", name: "Acme", slug: "acme", brandAccent: null, brandLogoUrl: null },
      user: { email: "a@acme.test", name: "Ada" },
    };
    expect(toolCtx(member)).toEqual({ actorId: "actor-1", orgId: "org-1", accessLevel: "elevated", source: "dashboard" });
  });
});
