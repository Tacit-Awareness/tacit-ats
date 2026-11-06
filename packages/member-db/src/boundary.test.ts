import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The raw connection stays in this package. connection.ts reads the pooler's
 * URL and holds the pool; member.ts is the one file that uses it, and the
 * package's entry point exports withMember and its types, never the pool.
 * The apps' import tests (apps/web/src/client-area.test.ts,
 * apps/mcp/src/client-connector.test.ts) hold the other side: nothing there
 * reads the URL, opens Postgres or imports past this entry point.
 */
const SRC = dirname(fileURLToPath(import.meta.url));
const PKG = join(SRC, "..");
const sources = readdirSync(SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const text = (f: string) => readFileSync(join(SRC, f), "utf8");

describe("the member database's own boundary", () => {
  test("its source is these three files", () => {
    expect(sources.sort()).toEqual(["connection.ts", "index.ts", "member.ts"]);
  });

  test("only connection.ts reads the URL or imports the driver as a value", () => {
    expect(sources.filter((f) => /SUPABASE_POOLER_URL|process\.env/.test(text(f)))).toEqual(["connection.ts"]);
    expect(sources.filter((f) => /^import\s+(?!type\b)[^;]*from\s+["']postgres["']/m.test(text(f)))).toEqual(["connection.ts"]);
  });

  test("only member.ts imports connection.ts", () => {
    expect(sources.filter((f) => /from\s+["']\.\/connection(\.js)?["']/.test(text(f)))).toEqual(["member.ts"]);
  });

  test("the entry point exports withMember and its kin, not the pool", () => {
    const index = text("index.ts");
    expect(index).not.toMatch(/\.\/connection/);
    const values = [...index.matchAll(/^export\s+\{([^}]*)\}/gm)].flatMap((m) => m[1]!.split(",").map((s) => s.trim()).filter(Boolean));
    expect(values.sort()).toEqual(["MemberClaimsError", "memberTransaction", "withMember"]);
    expect(index).not.toMatch(/export\s+\*/);
  });

  test("package.json exports the entry point only, so no deep import reaches connection.ts", () => {
    const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
    expect(Object.keys(pkg.exports)).toEqual(["."]);
  });

  test("member.ts exports nothing that hands out the pool", () => {
    const exported = [...text("member.ts").matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm)].map((m) => m[1]);
    expect(exported.sort()).toEqual(["MemberClaimsError", "memberClaimsJson", "memberTransaction", "withMember"]);
    expect(text("member.ts").match(/memberPool\(\)/g)).toHaveLength(1);
  });
});
