import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The client area's default-deny rules, checked against the source itself.
 *
 * A member of a client org must only ever act through their own token, so
 * that RLS decides what they see. Two things would break that silently: a
 * file in the client area importing the staff database client (which reads
 * all of Tacit's data), and a server action that forgets to check who is
 * calling. A server action is reachable by its id from any page the proxy
 * lets through, so the path split in proxy.ts does not cover actions on its
 * own; each one has to check.
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
const STAFF_DB = join(SRC, "lib/db.ts");
/** The one client-area module allowed a privileged client: first sign-in binding. */
const ALLOWED = new Set([join(SRC, "lib/client/bind.ts")]);

describe("the client area never holds a staff database client", () => {
  const roots = [...walk(join(SRC, "app/client")), ...walk(join(SRC, "lib/client"))];

  test("there is a client area to check", () => {
    expect(roots.map(rel)).toContain("app/client/page.tsx");
    expect(roots.map(rel)).toContain("lib/client/session.ts");
  });

  test("nothing it imports, at any depth, reaches lib/db or a privileged client", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    const visit = (file: string, trail: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      const here = [...trail, rel(file)];
      if (file === STAFF_DB) offenders.push(`${here.join(" -> ")} (the staff database client)`);
      else if (!ALLOWED.has(file) && PRIVILEGED.test(readFileSync(file, "utf8"))) {
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

  test("the allowed module exports a verdict, not a client", () => {
    const text = readFileSync(join(SRC, "lib/client/bind.ts"), "utf8");
    const exported = [...text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm)].map((m) => m[1]);
    expect(exported).toEqual(["bindInvitedActor"]);
  });

  test("the staff side never borrows the client area's session", () => {
    const borrowers = walk(SRC)
      .filter((f) => !roots.includes(f) && f !== join(SRC, "proxy.ts"))
      .filter((f) => importsOf(f).some((spec) => /^@\/lib\/client\/(session|bind)$/.test(spec)));
    expect(borrowers.map(rel)).toEqual([]);
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
    expect(actionFiles.map(rel)).toContain("app/actions.ts");
  });

  test("a 'use server' file exports only async functions", () => {
    const others = actionFiles.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/^export\s+(?!async function\b|type\b|interface\b)(.*)$/gm)].map(
        (m) => `${rel(file)}: export ${m[1].slice(0, 60)}`,
      ),
    );
    expect(others, "Anything else exported from a 'use server' file is either an error or an unchecked action.").toEqual([]);
  });

  test("each one starts with requireUser() or requireClient()", () => {
    const unchecked: string[] = [];
    let total = 0;
    for (const file of actionFiles) {
      const text = readFileSync(file, "utf8");
      const inClientArea = rel(file).startsWith("app/client/");
      for (const m of text.matchAll(/^export async function (\w+)\s*(?:<[^>]*>)?\(/gm)) {
        total++;
        const first = firstStatement(text, m.index + m[0].length - 1);
        // A staff action checks the staff session; a client-area action the client one. Never the other's.
        const wanted = inClientArea ? /\bawait requireClient\(\)/ : /\bawait requireUser\(\)/;
        if (!wanted.test(first)) unchecked.push(`${rel(file)}: ${m[1]} starts with \`${first.slice(0, 70)}\``);
      }
    }
    expect(total).toBeGreaterThan(40);
    expect(
      unchecked,
      "A server action can be invoked by its id from any page the caller can load, so the proxy's path " +
        "check does not cover it. Make the session check its first statement, or move a function that is " +
        "not meant to be an action out of the 'use server' file.",
    ).toEqual([]);
  });
});
