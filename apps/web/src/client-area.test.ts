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
 * the signed challenge to the company's bot (its secret is never granted to a
 * member's token), and a member's own Granola notes (their OAuth grant is never
 * granted to a member's token, and using it rotates it, so a definer function
 * would only hand the secret over). Each lets the member's own token decide
 * first: granola-notes.ts takes no actor or org, only what the member's token
 * reads of its own granola_connections row, so it cannot name another's grant.
 * file-store.ts holds the bytes of a candidate's file, in a bucket with no
 * member policies: core calls it only after the member's own token has read or
 * inserted the row, and the path is that row's.
 */
const ALLOWED = new Set([join(SRC, "lib/client/bind.ts"), join(SRC, "lib/client/bot.ts"), join(SRC, "lib/client/granola-notes.ts"), join(SRC, "lib/client/file-store.ts")]);

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
    expect(exportsOf("lib/client/granola-notes.ts")).toEqual(["readGranolaNotes"]);
    expect(exportsOf("lib/client/file-store.ts")).toEqual(["webFileStore"]);
  });
});

/**
 * Book, move and cancel need members' calendar grants, which no member token
 * can read, so they reach the service role by one way only: the route below,
 * in a route group, outside the roots above, reading through one module. These
 * hold that way shut: what the route reaches, who imports the module, what the
 * module hands out, and what the route checks before anything else.
 */
describe("the one way to a member's calendar grants", () => {
  const ROUTE = join(SRC, "app/(member-calendar)/client/schedule/api/route.ts");
  const GRANTS = join(SRC, "lib/member-calendar/grants.ts");
  const nonTest = walk(SRC);

  test("the route and the module are where this says", () => {
    expect(existsSync(ROUTE)).toBe(true);
    expect(existsSync(GRANTS)).toBe(true);
  });

  test("everything in the route group is that one route", () => {
    expect(walk(join(SRC, "app/(member-calendar)")).map(rel)).toEqual([rel(ROUTE)]);
  });

  test("only the route imports the module", () => {
    const importers = nonTest.filter((f) => f !== GRANTS && importsOf(f).some((spec) => resolveLocal(f, spec) === GRANTS));
    expect(importers.map(rel)).toEqual([rel(ROUTE)]);
  });

  test("nothing in the client area imports the route", () => {
    const roots = [...walk(join(SRC, "app/client")), ...walk(join(SRC, "lib/client"))];
    expect(roots.filter((f) => importsOf(f).some((spec) => resolveLocal(f, spec) === ROUTE)).map(rel)).toEqual([]);
  });

  test("past the session's own binding, only the module names a privileged client", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      if (ALLOWED.has(file) || file === GRANTS) return;
      if (PRIVILEGED.test(readFileSync(file, "utf8"))) offenders.push(rel(file));
      for (const spec of importsOf(file)) {
        const next = resolveLocal(file, spec);
        if (next) visit(next);
      }
    };
    visit(ROUTE);
    expect(offenders).toEqual([]);
  });

  test("the module hands out a function, never a client", () => {
    const text = readFileSync(GRANTS, "utf8");
    expect([...text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class|type)\s+(\w+)/gm)].map((m) => m[1])).toEqual(["memberCalendar"]);
    // The client is built inside the read, and stops there.
    expect(text.match(/getSupabaseServiceClient/g)).toHaveLength(2);
    expect(text).toMatch(/await getSupabaseServiceClient\(\)\s*\.from\("calendar_connections"\)/);
  });

  test("the route is one POST, asks who is calling first, and checks where it came from before it reads the body", () => {
    const text = readFileSync(ROUTE, "utf8");
    expect([...text.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map((m) => m[1])).toEqual(["POST"]);
    const body = text.slice(text.indexOf("export async function POST"));
    const steps = ["await resolveClient()", "sameOrigin(request.headers)", "request.text()", "parseScheduleRequest(body)", "memberCalendar("];
    const at = steps.map((s) => body.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test("the proxy's sign-in covers its address", () => {
    expect(rel(ROUTE).replace("app/(member-calendar)", "").replace("/route.ts", "")).toMatch(/^\/client\//);
  });
});

describe("the public job pages hold no session and no client but the publishable key", () => {
  // /careers/[org], /jobs/[slug] and /api/jobs/[slug]/apply are outside the proxy's sign-in
  // check on purpose. What they can reach must not be able to act as anyone:
  // no privileged database client, no client session.
  const roots = [...walk(join(SRC, "app/careers")), ...walk(join(SRC, "app/jobs")), ...walk(join(SRC, "app/api/jobs")), ...walk(join(SRC, "components/careers")), ...walk(join(SRC, "lib/public"))];
  const SESSIONS = new Set([join(SRC, "lib/client/session.ts"), join(SRC, "lib/client/bind.ts")]);

  test("there are public pages to check", () => {
    expect(roots.map(rel)).toEqual(expect.arrayContaining(["app/careers/[org]/page.tsx", "app/jobs/[slug]/page.tsx", "app/api/jobs/[slug]/apply/route.ts", "components/careers/frame.tsx", "lib/public/jobs.ts"]));
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
    expect(actionFiles.map(rel)).toContain("app/client/interviewers/actions.ts");
    expect(actionFiles.map(rel)).toContain("app/client/onboarding/actions.ts");
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

/**
 * The server-side packages stay out of the browser: @tacit/core's barrel is
 * tacit-internal's domain logic and a megabyte of JavaScript, and the first
 * value import from a client component ships all of it to every member. A
 * type import is erased, so it does not count.
 */
describe("a client component never reaches the server's packages", () => {
  const SERVER_ONLY = /^@tacit(-ats)?\/(core|db)(\/|$)/;
  const VALUE_IMPORT = /^\s*(?:import|export)\s+(?!type\b)([^;'"]*?)\s+from\s*["']([^"']+)["']/gm;

  const valueImportsOf = (file: string): string[] =>
    [...readFileSync(file, "utf8").matchAll(VALUE_IMPORT)]
      .filter((m) => !/^\{(\s*type\s+[^,}]+,?)*\s*\}$/.test(m[1]!.trim()))
      .map((m) => m[2]!);

  test("no value import from a \"use client\" file, at any depth, lands on @tacit/core, @tacit/db or @tacit-ats/core", () => {
    const roots = walk(SRC).filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
    expect(roots.map(rel)).toContain("app/client/candidates/bulk.tsx");
    const offenders: string[] = [];
    const seen = new Set<string>();
    const visit = (file: string, trail: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      const here = [...trail, rel(file)];
      for (const spec of valueImportsOf(file)) {
        if (SERVER_ONLY.test(spec)) offenders.push(`${here.join(" -> ")} -> ${spec}`);
        const next = resolveLocal(file, spec);
        // A server action reached from a client file is a reference across the boundary, not code in the bundle.
        if (next && !/^\s*["']use server["']/.test(readFileSync(next, "utf8"))) visit(next, here);
      }
    };
    for (const root of roots) visit(root, []);
    expect(offenders, "Keep the constant or type a client component needs in a module with no such import.").toEqual([]);
  });
});
