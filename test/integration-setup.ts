import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Points the integration suite at the local Supabase stack by reading
 * `supabase status` from packages/db and exporting the URL/service key as
 * the same env vars production code reads. Env set here is inherited by
 * vitest's worker processes.
 */
export default function setup(): void {
  const dbDir = fileURLToPath(new URL("../packages/db", import.meta.url));

  let output: string;
  try {
    output = execFileSync("supabase", ["status", "-o", "env"], {
      cwd: dbDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "Local Supabase stack is not running. Run `supabase start` in packages/db first " +
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
  if (!url || !serviceKey) {
    throw new Error(
      `Could not find API_URL / SERVICE_ROLE_KEY in \`supabase status -o env\` output. Keys seen: ${[...vars.keys()].join(", ")}`,
    );
  }

  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SECRET_KEY = serviceKey;
}
