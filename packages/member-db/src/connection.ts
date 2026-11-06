import postgres from "postgres";

/**
 * The raw connection: privileged, and private to this package.
 *
 * SUPABASE_POOLER_URL is the Supabase transaction pooler (Supavisor, port
 * 6543). Its login role can become anyone the database allows it to, so the
 * pool it opens is never handed out: member.ts's withMember is its only
 * caller, and it opens every transaction as `authenticated` with a member's
 * claims before any of the caller's SQL runs. index.ts does not export this
 * file, package.json's `exports` refuses a deep import of it, and
 * src/boundary.test.ts plus the two apps' import tests hold both.
 *
 * Read lazily, on the first transaction, never at module load: importing the
 * package opens nothing.
 */
let pool: postgres.Sql | null = null;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function memberPool(): postgres.Sql {
  if (pool) return pool;
  const url = process.env.SUPABASE_POOLER_URL?.trim();
  if (!url) throw new Error("SUPABASE_POOLER_URL is not set: the member database connection is not configured on this deployment");
  const local = LOCAL_HOSTS.has(new URL(url).hostname);
  pool = postgres(url, {
    // The transaction pooler hands each transaction whichever server
    // connection is free, so a statement prepared on one is not there for the
    // next: no named prepared statements.
    prepare: false,
    // One serverless instance serves a handful of requests at once; the
    // pooler multiplexes them onto its own small set of server connections.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: local ? false : "require",
    onnotice: () => {},
    connection: { application_name: "tacit-ats" },
  });
  return pool;
}

/** Closes the pool (tests, and a clean shutdown). The next transaction opens a new one. */
export async function closeMemberPool(): Promise<void> {
  const open = pool;
  pool = null;
  await open?.end({ timeout: 5 });
}
