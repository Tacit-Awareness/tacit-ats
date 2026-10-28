import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The client area's default-deny rules, checked against the source itself.
 *
 * A member of a client org must only ever act through their own token, so
 * that RLS decides what they see. Two things would break that silently: a
 * file importing a privileged database client (the service role, or
 * tacit_internal, which reads all of Tacit's data), and a server action that
 * forgets to check who is calling. A server action is reachable by its id
 * from any page, so the proxy does not cover actions on its own; each one has
 * to check.
 */
const SRC = dirname(fileURLToPath(import.meta.url));
const rel = (file: string) => relative(SRC, file);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const IMPORT = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** A local import's file, or null for a package. */
function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`client-area.test: cannot resolve "${spec}" imported by ${rel(from)}`);
}

/** Names that hand back a database client which is not the signed-in user's. */
const PRIVILEGED = /\b(getSupabaseServiceClient|getSupabaseTacitClient|createServiceClient|createTacitClient)\b/;
/**
 * The client-area modules allowed a privileged client: first sign-in binding,
 * and the signed challenge to the company's bot (its secret is never granted
 * to a member's token).
 */
const ALLOWED = new Set([join(SRC, "lib/client/bind.ts"), join(SRC, "lib/client/bot.ts")]);

describe("the client area never holds a privileged database client", () => {
  const roots = [...walk(join(SRC, "app/client")), ...walk(join(SRC, "lib/client"))];

  test("there is a client area to check", () => {
    expect(roots.map(rel)).toContain("app/client/page.tsx");
    expect(roots.map(rel)).toContain("lib/client/session.ts");
  });

  test("nothing it imports, at any depth, reaches a privileged client", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    const visit = (file: string, trail: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      const here = [...trail, rel(file)];
      if (!ALLOWED.has(file) && PRIVILEGED.test(readFileSync(file, "utf8"))) {
        offenders.push(`${here.join(" -> ")} (names a privileged client)`);
      }
      // What the allowed module imports is its own business; its callers get a verdict, never the client.
      if (ALLOWED.has(file)) return;
      for (const spec of importsOf(file)) {
        const next = resolveLocal(file, spec);
        if (next) visit(next, here);
      }
    };
    for (const root of roots) visit(root, []);

    expect(
      offenders,
      "A file reachable from app/client or lib/client can get a database client that is not the signed-in " +
        "user's. Use the `db` on requireClient() / resolveClient() instead.",
    ).toEqual([]);
  });

  test("the allowed modules export a verdict, not a client", () => {
    const exportsOf = (file: string) =>
      [...readFileSync(join(SRC, file), "utf8").matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm)].map((m) => m[1]);
    expect(exportsOf("lib/client/bind.ts")).toEqual(["bindInvitedActor"]);
    expect(exportsOf("lib/client/bot.ts")).toEqual(["verifyCompanyBot"]);
  });
});

describe("the public job pages hold no session and no client but the publishable key", () => {
  // /jobs/[slug] and /api/jobs/[slug]/apply are outside the proxy's sign-in
  // check on purpose. What they can reach must not be able to act as anyone:
  // no privileged database client, no client session.
  const roots = [...walk(join(SRC, "app/jobs")), ...walk(join(SRC, "app/api/jobs")), ...walk(join(SRC, "lib/public"))];
  const SESSIONS = new Set([join(SRC, "lib/client/session.ts"), join(SRC, "lib/client/bind.ts")]);

  test("there are public pages to check", () => {
    expect(roots.map(rel)).toEqual(expect.arrayContaining(["app/jobs/[slug]/page.tsx", "app/api/jobs/[slug]/apply/route.ts", "lib/public/jobs.ts"]));
  });

  test("nothing they import, at any depth, reaches a session or a privileged client, and none is an action", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    const visit = (file: string, trail: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      const here = [...trail, rel(file)];
      const text = readFileSync(file, "utf8");
      if (SESSIONS.has(file)) offenders.push(`${here.join(" -> ")} (a session)`);
      if (PRIVILEGED.test(text)) offenders.push(`${here.join(" -> ")} (names a privileged client)`);
      if (/^\s*(["'])use server\1/.test(text)) offenders.push(`${here.join(" -> ")} (a server action file)`);
      for (const spec of importsOf(file)) {
        const next = resolveLocal(file, spec);
        if (next) visit(next, here);
      }
    };
    for (const root of roots) visit(root, []);
    expect(offenders, "The public job pages must act as anon: lib/public/jobs.ts's client and nothing else.").toEqual([]);
  });
});

describe("every server action checks who is calling, first", () => {
  const actionFiles = walk(SRC).filter((f) => /^\s*(["'])use server\1/.test(readFileSync(f, "utf8")));

  /** The first statement of the function whose parameter list opens at `open`. */
  function firstStatement(text: string, open: number): string {
    let i = open + 1;
    for (let depth = 1; depth > 0; i++) depth += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
    // Skip a return type, which may itself contain braces: the body's brace is the one followed by a newline.
    const body = text.slice(text.indexOf("{\n", i) + 1);
    return (
      body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*")) ?? ""
    );
  }

  test("there are server actions to check", () => {
    expect(actionFiles.map(rel)).toContain("app/client/team/actions.ts");
  });

  test("a 'use server' file exports only async functions", () => {
    const others = actionFiles.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/^export\s+(?!async function\b|type\b|interface\b)(.*)$/gm)].map(
        (m) => `${rel(file)}: export ${m[1].slice(0, 60)}`,
      ),
    );
    expect(others, "Anything else exported from a 'use server' file is either an error or an unchecked action.").toEqual([]);
  });

  test("each one starts with requireClient()", () => {
    const unchecked: string[] = [];
    let total = 0;
    for (const file of actionFiles) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/^export async function (\w+)\s*(?:<[^>]*>)?\(/gm)) {
        total++;
        const first = firstStatement(text, m.index + m[0].length - 1);
        if (!/\bawait requireClient\(\)/.test(first)) unchecked.push(`${rel(file)}: ${m[1]} starts with \`${first.slice(0, 70)}\``);
      }
    }
    expect(total).toBeGreaterThan(5);
    expect(
      unchecked,
      "A server action can be invoked by its id from any page the caller can load, so the proxy's path " +
        "check does not cover it. Make the session check its first statement, or move a function that is " +
        "not meant to be an action out of the 'use server' file.",
    ).toEqual([]);
  });
});
