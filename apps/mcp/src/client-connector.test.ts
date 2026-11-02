import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The client connector's default-deny rule, checked against the source.
 *
 * Every client tool must read and write through the member's own database
 * client, so that RLS decides. Nothing reachable from src/client or the
 * /api/client route may get another client (the service role, tacit_internal,
 * or lib/context's db()) except the five modules below, which hand back a
 * verdict, write one audit row, sign and store one file, read calendar
 * grants, or read the caller's Granola token, and never return a client. files.ts is there because the
 * `org-files` bucket has no policies for a member's token: signing a link and
 * uploading need the service role. Core calls it only after the member's own
 * client has read or inserted the person_files row, so RLS has decided, and
 * only with that row's own path. calendar.ts is there because a member's
 * calendar refresh token is granted to no member token (calendar_connections);
 * core asks it only for the caller and the interviewers or event holder the
 * member's own token has already been allowed to name, inside their org.
 * granola.ts is there because a member's Granola grant is granted to no
 * member token (granola_connections), and refreshing it writes the rotated
 * refresh token back; core asks it only for the caller.
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
const importsOf = (file: string) => [...readFileSync(file, "utf8").matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3]);

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec.replace(/\.js$/, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`client-connector.test: cannot resolve "${spec}" imported by ${rel(from)}`);
}

const PRIVILEGED = /\b(getSupabaseServiceClient|getSupabaseTacitClient|createServiceClient|createTacitClient|mintTacitInternalToken)\b/;
const CONTEXT = join(SRC, "lib/context.ts");
const ALLOWED = new Set([
  join(SRC, "client/bind.ts"), join(SRC, "client/audit.ts"), join(SRC, "client/files.ts"), join(SRC, "client/calendar.ts"),
  join(SRC, "client/granola.ts"), join(SRC, "client/mailbox.ts"),
]);

describe("the client connector never holds a database client other than the member's", () => {
  const roots = [...walk(join(SRC, "client")), ...walk(join(SRC, "app/api/client"))];

  test("there is a client connector to check", () => {
    expect(roots.map(rel)).toEqual(expect.arrayContaining(["client/server.ts", "client/session.ts", "app/api/client/route.ts"]));
  });

  test("nothing it imports, at any depth, reaches lib/context or a privileged client", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    const visit = (file: string, trail: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      const here = [...trail, rel(file)];
      if (file === CONTEXT) offenders.push(`${here.join(" -> ")} (lib/context's db())`);
      else if (!ALLOWED.has(file) && PRIVILEGED.test(readFileSync(file, "utf8"))) offenders.push(`${here.join(" -> ")} (names a privileged client)`);
      if (ALLOWED.has(file)) return;
      for (const spec of importsOf(file)) {
        const next = resolveLocal(file, spec);
        if (next) visit(next, here);
      }
    };
    for (const root of roots) visit(root, []);
    expect(offenders, "Use the member's `db` from resolveMember instead.").toEqual([]);
  });

  test("the six allowed modules export only their functions, and no client", () => {
    for (const [file, names] of [
      ["client/bind.ts", ["bindMember"]],
      ["client/audit.ts", ["auditClientCall", "clientBreadthExceeded"]],
      ["client/files.ts", ["signFileUrl", "putFile", "removeFiles"]],
      ["client/calendar.ts", ["calendarConnections"]],
      ["client/granola.ts", ["granolaAccessToken"]],
      ["client/mailbox.ts", ["ownMailbox"]],
    ] as const) {
      const text = readFileSync(join(SRC, file), "utf8");
      const exported = [...text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm)].map((m) => m[1]);
      expect(exported, file).toEqual(names);
    }
  });

  test("nothing outside the client connector borrows its member resolution", () => {
    const borrowers = walk(SRC)
      .filter((f) => !roots.includes(f))
      .filter((f) => importsOf(f).some((spec) => /client\/(session|bind)$/.test(spec)));
    expect(borrowers.map(rel)).toEqual([]);
  });
});
