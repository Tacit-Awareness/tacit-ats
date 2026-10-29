import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * What tats keeps on disk: the sign-in per server in the config directory
 * (0600, since it holds a refresh token), and each server's tool list and
 * instructions in the cache directory. XDG_CONFIG_HOME and XDG_CACHE_HOME are
 * honoured; otherwise ~/.config/tats and ~/.cache/tats on every platform.
 */

export type Tokens = {
  access_token: string;
  refresh_token?: string;
  /** Epoch milliseconds. Absent = unknown, the token is used until the server refuses it. */
  expires_at?: number;
};

export type Session = {
  issuer: string;
  /** The audience the token was asked for: the resource the server's metadata names. */
  resource: string;
  token_endpoint: string;
  /** The dynamically registered client, reused while the redirect URI stays the same. */
  client_id: string;
  redirect_uri: string;
  tokens: Tokens;
};

export type Tool = {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
  format?: string;
};

export type Catalog = { fetched_at: number; instructions: string | null; tools: Tool[] };

export type Registration = Omit<Session, "tokens">;

export type Store = {
  session(server: string): Promise<Session | null>;
  /** The registered client, signed in or not: a logout keeps it, so the next login does not register another. */
  registration(server: string): Promise<Registration | null>;
  saveSession(server: string, session: Session): Promise<void>;
  forgetTokens(server: string): Promise<boolean>;
  catalog(server: string): Promise<Catalog | null>;
  saveCatalog(server: string, catalog: Catalog): Promise<void>;
};

type Credentials = { servers: Record<string, Session | Registration> };

export function directories(env: NodeJS.ProcessEnv) {
  const home = env.HOME || homedir();
  return {
    config: join(env.XDG_CONFIG_HOME || join(home, ".config"), "tats"),
    cache: join(env.XDG_CACHE_HOME || join(home, ".cache"), "tats"),
  };
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown, mode: number) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode });
}

const cacheName = (server: string) => encodeURIComponent(server.replace(/^https?:\/\//, "")) + ".json";

export function fileStore(env: NodeJS.ProcessEnv): Store {
  const dirs = directories(env);
  const credentialsPath = join(dirs.config, "credentials.json");
  const credentials = async () => (await readJson<Credentials>(credentialsPath)) ?? { servers: {} };

  return {
    async session(server) {
      const s = (await credentials()).servers[server];
      return s && "tokens" in s ? s : null;
    },
    async registration(server) {
      const s = (await credentials()).servers[server];
      if (!s) return null;
      const { issuer, resource, token_endpoint, client_id, redirect_uri } = s;
      return { issuer, resource, token_endpoint, client_id, redirect_uri };
    },
    async saveSession(server, session) {
      const all = await credentials();
      all.servers[server] = session;
      await writeJson(credentialsPath, all, 0o600);
    },
    async forgetTokens(server) {
      const all = await credentials();
      const s = all.servers[server];
      if (!s || !("tokens" in s)) return false;
      const { tokens: _, ...rest } = s;
      all.servers[server] = rest;
      await writeJson(credentialsPath, all, 0o600);
      await rm(join(dirs.cache, cacheName(server)), { force: true });
      return true;
    },
    catalog: (server) => readJson<Catalog>(join(dirs.cache, cacheName(server))),
    saveCatalog: (server, catalog) => writeJson(join(dirs.cache, cacheName(server)), catalog, 0o600),
  };
}

