import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Points the integration suite at the local Supabase stack by reading
 * `supabase status` from the Tacit-Awareness checkout's packages/db (the
 * schema and migrations live there, not here; TACIT_REPO overrides the
 * default ../Tacit-Awareness) and exporting the URL/service key as
 * the same env vars production code reads. Env set here is inherited by
 * vitest's worker processes.
 */
export default function setup(): void {
  const tacitRepo = process.env.TACIT_REPO
    ? resolve(process.env.TACIT_REPO)
    : fileURLToPath(new URL("../../Tacit-Awareness", import.meta.url));
  const dbDir = join(tacitRepo, "packages/db");

  let output: string;
  try {
    output = execFileSync("supabase", ["status", "-o", "env"], {
      cwd: dbDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      `Local Supabase stack is not running. Run \`supabase start\` in ${dbDir} first ` +
        "(requires Docker), then `supabase db reset` to apply migrations.",
    );
  }

  const vars = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
    if (match) vars.set(match[1], match[2]);
  }

  const url = vars.get("API_URL");
  const serviceKey = vars.get("SERVICE_ROLE_KEY") ?? vars.get("SECRET_KEY");
  const anonKey = vars.get("ANON_KEY") ?? vars.get("PUBLISHABLE_KEY");
  // Direct Postgres URL, for the one assertion PostgREST cannot serve:
  // catalog tables like pg_class are not in an exposed schema.
  const dbUrl = vars.get("DB_URL");
  if (!url || !serviceKey || !anonKey || !dbUrl) {
    throw new Error(
      `Could not find API_URL / SERVICE_ROLE_KEY / ANON_KEY / DB_URL in \`supabase status -o env\` output. Keys seen: ${[...vars.keys()].join(", ")}`,
    );
  }

  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SECRET_KEY = serviceKey;
  process.env.SUPABASE_ANON_KEY = anonKey;
  process.env.SUPABASE_DB_URL = dbUrl;
  // The local stack's shared JWT secret: lets a test sign a member token the
  // way production signs one with the project key (apps/mcp's client connector).
  const jwtSecret = vars.get("JWT_SECRET");
  if (jwtSecret) process.env.SUPABASE_JWT_SECRET = jwtSecret;
}
