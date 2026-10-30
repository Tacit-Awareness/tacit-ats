import type { Db } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import type { FileStore } from "./files.js";

/**
 * Duplicates, merging and GDPR erasure for the client connector
 * (20261016160000_client_merge_anonymize). All three are for a client org's
 * admins only. The two writes are the security definer functions
 * client_merge_candidates and client_anonymize_candidate, called on the
 * member's own token: the database checks the caller is an admin of the org
 * both people are in, and the code here checks the same first only to answer
 * with a sentence.
 *
 * A merge is soft: the duplicate's row stays, marked merged into the record
 * kept, and is hidden from members. An erasure is not: the person's data is
 * gone, their applications' stages and dates are kept for reporting, and the
 * files' bytes are removed from Storage after the database has committed.
 */

const SCAN_MAX = 5000;
const PAGE = 1000;
const GROUPS_MAX = 50;
/** The name client_anonymize_candidate leaves on an erased candidate's row. */
export const ANONYMIZED_NAME = "Anonymized candidate";

const adminsOnly = (what: string) => new ClientToolError("forbidden", `Only an admin at your company can ${what}.`);
const notFound = (which = "a candidate") =>
  new ClientToolError("not_found", `No candidate with that id that you can see, for ${which}. Call search_candidates for the ids.`);

export type DuplicateReason = "email" | "linkedin" | "name";

export type DuplicateCandidate = {
  candidateId: string;
  name: string | null;
  email: string | null;
  headline: string | null;
  createdAt: string;
  /** How many of their applications the member can see. */
  jobs: number;
};

export type DuplicateGroup = {
  /** What the candidates in the group have in common, any of them with any other. */
  matchedOn: DuplicateReason[];
  /** Oldest first: the first is usually the record to keep. */
  candidates: DuplicateCandidate[];
};

export type Duplicates = {
  candidateId: string | null;
  groups: DuplicateGroup[];
  /** How many candidates were compared; true when the org has more than SCAN_MAX and the rest were not. */
  scanned: number;
  truncated: boolean;
};

type ScanRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  linkedin_url: string | null;
  current_title: string | null;
  current_company: string | null;
  created_at: string;
  applications?: Array<{ count: number }>;
};

/** A LinkedIn profile as linkedin.com/in/<slug>, or null when it is not one. */
export function linkedinKey(url: string | null): string | null {
  if (!url) return null;
  const clean = url.trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^([a-z]{2,3}\.)?www\./, "").replace(/^[a-z]{2}\./, "")
    .replace(/[?#].*$/, "").replace(/\/+$/, "");
  const m = /^linkedin\.com\/in\/([^/]+)/.exec(clean);
  return m ? `linkedin.com/in/${decodeURIComponentSafe(m[1])}` : null;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const emailKey = (email: string | null) => {
  const e = email?.trim().toLowerCase();
  return e && e.includes("@") ? e : null;
};

const nameKey = (name: string | null) => {
  const n = name?.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return n && n.length > 1 && n !== ANONYMIZED_NAME.toLowerCase() ? n : null;
};

const headline = (title: string | null, company: string | null) => [title, company].filter(Boolean).join(" at ") || null;

async function scanPeople(db: Db): Promise<{ rows: ScanRow[]; truncated: boolean }> {
  const rows: ScanRow[] = [];
  for (let from = 0; from < SCAN_MAX; from += PAGE) {
    // The member's own read: a merged candidate is hidden by the policy, an anonymized one filtered here.
    const { data, error } = await db
      .from("people")
      .select("id, display_name, email, linkedin_url, current_title, current_company, created_at, applications(count)")
      .is("anonymized_at", null)
      .order("created_at")
      .order("id")
      .range(from, Math.min(from + PAGE, SCAN_MAX) - 1)
      .overrideTypes<ScanRow[], { merge: false }>();
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Every email a person has on file beside the one on their row (person_identifiers). */
async function extraEmails(db: Db, ids: Set<string>): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let from = 0; from < SCAN_MAX * 2; from += PAGE) {
    const { data, error } = await db
      .from("person_identifiers")
      .select("person_id, value")
      .eq("kind", "email")
      .order("person_id")
      .order("value")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      if (ids.has(r.person_id)) out.set(r.person_id, [...(out.get(r.person_id) ?? []), r.value]);
    }
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

/**
 * Likely duplicates among the candidates the admin can see: the same email
 * (ignoring case, the row's or any on file), the same LinkedIn profile, or
 * exactly the same name. Grouped: two candidates sharing an email and a third
 * sharing the second's name are one group. With a candidateId, only that
 * candidate's group. Read-only; merge_candidates does the merging.
 */
export async function findDuplicates(db: Db, ctx: ClientToolCtx, input: { candidateId?: string } = {}): Promise<Duplicates> {
  if (ctx.accessLevel !== "admin") throw adminsOnly("look for duplicate candidates");
  const { rows, truncated } = await scanPeople(db);
  if (input.candidateId && !rows.some((r) => r.id === input.candidateId)) {
    // Either not theirs to see, merged, anonymized, or beyond the scan.
    const { data, error } = await db.from("people").select("id, anonymized_at").eq("id", input.candidateId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound();
    if (data.anonymized_at) throw new ClientToolError("invalid", "That candidate was anonymized: there is nothing left to match.");
    // Visible, but past the first SCAN_MAX candidates compared.
    return { candidateId: input.candidateId, groups: [], scanned: rows.length, truncated: true };
  }
  const emails = await extraEmails(db, new Set(rows.map((r) => r.id)));

  // Union-find over people, joined by any shared key.
  const parent = new Map(rows.map((r) => [r.id, r.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const reasons = new Map<string, Set<DuplicateReason>>();
  const firstWith = new Map<string, string>();
  const link = (key: string, reason: DuplicateReason, id: string) => {
    const seen = firstWith.get(`${reason}:${key}`);
    if (!seen) {
      firstWith.set(`${reason}:${key}`, id);
      return;
    }
    if (seen === id) return;
    const a = find(seen);
    const b = find(id);
    const merged = new Set([...(reasons.get(a) ?? []), ...(reasons.get(b) ?? []), reason]);
    if (a !== b) parent.set(b, a);
    reasons.set(a, merged);
  };
  for (const r of rows) {
    const mine = new Set([emailKey(r.email), ...(emails.get(r.id) ?? []).map(emailKey)].filter((e): e is string => !!e));
    for (const e of mine) link(e, "email", r.id);
    const li = linkedinKey(r.linkedin_url);
    if (li) link(li, "linkedin", r.id);
    const n = nameKey(r.display_name);
    if (n) link(n, "name", r.id);
  }

  const clusters = new Map<string, ScanRow[]>();
  for (const r of rows) {
    const root = find(r.id);
    clusters.set(root, [...(clusters.get(root) ?? []), r]);
  }
  const wanted = input.candidateId ? find(input.candidateId) : null;
  const groups = [...clusters.entries()]
    .filter(([root, members]) => members.length > 1 && (!wanted || root === wanted))
    .map(([root, members]) => ({
      matchedOn: (["email", "linkedin", "name"] as const).filter((k) => reasons.get(root)?.has(k)),
      candidates: members.map((m) => ({
        candidateId: m.id,
        name: m.display_name,
        email: m.email,
        headline: headline(m.current_title, m.current_company),
        createdAt: m.created_at,
        jobs: m.applications?.[0]?.count ?? 0,
      })),
    }))
    // Strongest evidence first (an email or a profile beats a name), then the biggest.
    .sort((a, b) => Number(b.matchedOn[0] !== "name") - Number(a.matchedOn[0] !== "name") || b.candidates.length - a.candidates.length)
    .slice(0, GROUPS_MAX);
  return { candidateId: input.candidateId ?? null, groups, scanned: rows.length, truncated };
}

type PersonCard = { id: string; display_name: string | null; anonymized_at: string | null };

async function readPeople(db: Db, ids: string[]): Promise<Map<string, PersonCard>> {
  const { data, error } = await db.from("people").select("id, display_name, anonymized_at").in("id", ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((p) => [p.id, p]));
}

/** The database's refusals, as sentences. Null for anything that is not one. */
function refusal(error: { code?: string; message: string }, what: "merge" | "anonymize"): ClientToolError | null {
  switch (error.code) {
    case "42501":
      return adminsOnly(what === "merge" ? "merge candidates" : "anonymize a candidate");
    case "P0002":
      return notFound();
    case "22023":
      return what === "merge"
        ? new ClientToolError("invalid", "Pick two different candidates: keep_id and merge_id are the same.")
        : new ClientToolError("invalid", confirmHelp());
    case "55000":
      if (/anonymized/.test(error.message)) {
        return new ClientToolError("invalid", "That candidate was anonymized, so they cannot be merged or anonymized again.");
      }
      if (/team member/.test(error.message)) {
        return new ClientToolError("invalid", "That candidate is linked to someone on your team. Ask Tacit to help with this one.");
      }
      if (/merged/.test(error.message)) {
        return new ClientToolError(
          "invalid",
          what === "merge"
            ? "One of them was already merged into another record. Use the record it was merged into."
            : "That record was merged into another. Anonymize the record it was merged into: that covers this one too.",
        );
      }
      return null;
    default:
      return null;
  }
}

export type MergeResult = {
  keepId: string;
  mergedId: string;
  keepName: string | null;
  mergedName: string | null;
  /** Jobs both were in: the more advanced application was kept, the other marked merged into it. */
  applicationsMerged: number;
  /** Rows moved to the record kept, by table and column. */
  moved: Record<string, number>;
  /** Rows left on the merged record because the kept one already had the same (a tag both carried, say). */
  leftBehind: Record<string, number>;
  /** Fields that were blank on the record kept and were filled from the other. */
  filled: string[];
};

/**
 * Merges one candidate into another, for an admin: everything on merge_id
 * moves to keep_id, a job both were in keeps the more advanced application,
 * keep_id's blank fields are filled from merge_id, and merge_id stays on file
 * marked merged into keep_id, hidden from your team.
 */
export async function mergeCandidates(db: Db, ctx: ClientToolCtx, input: { keepId: string; mergeId: string }): Promise<MergeResult> {
  if (ctx.accessLevel !== "admin") throw adminsOnly("merge candidates");
  if (input.keepId === input.mergeId) {
    throw new ClientToolError("invalid", "Pick two different candidates: keep_id and merge_id are the same.");
  }
  const people = await readPeople(db, [input.keepId, input.mergeId]);
  const keep = people.get(input.keepId);
  const merge = people.get(input.mergeId);
  if (!keep) throw notFound("keep_id");
  if (!merge) throw notFound("merge_id");
  if (keep.anonymized_at || merge.anonymized_at) {
    throw new ClientToolError("invalid", "That candidate was anonymized, so they cannot be merged or anonymized again.");
  }

  return withAudit(db, ctx, { action: "person.merge", entity: "person" }, async () => {
    const { data, error } = await db.rpc("client_merge_candidates", { p_keep: input.keepId, p_merge: input.mergeId });
    if (error) throw refusal(error, "merge") ?? new Error(error.message);
    const r = data as unknown as {
      applications_merged: number; moved: Record<string, number>; left_behind: Record<string, number>; filled: string[];
    };
    const result: MergeResult = {
      keepId: input.keepId,
      mergedId: input.mergeId,
      keepName: keep.display_name,
      mergedName: merge.display_name,
      applicationsMerged: r.applications_merged,
      moved: r.moved ?? {},
      leftBehind: r.left_behind ?? {},
      filled: r.filled ?? [],
    };
    return {
      result,
      entityId: input.keepId,
      // Ids, counts and column names: no one's data.
      before: { merged_id: input.mergeId },
      after: {
        merged_id: input.mergeId,
        applications_merged: result.applicationsMerged,
        moved: result.moved,
        left_behind: result.leftBehind,
        filled: result.filled,
      },
      changed: true,
    };
  });
}

/** What `confirm` must be for this candidate: their name as on file, or their id when there is none. */
export function confirmationFor(person: { id: string; display_name: string | null }): string {
  const name = person.display_name?.trim().replace(/\s+/g, " ");
  return `ANONYMIZE ${name || person.id}`;
}

const normalizeConfirm = (raw: string) => raw.trim().replace(/\s+/g, " ");

const confirmHelp = () =>
  'confirm must be exactly "ANONYMIZE " followed by the candidate\'s full name as Tacit has it ' +
  "(get_candidate shows it), typed after the user has said yes to erasing that candidate. Nothing was changed.";

export type AnonymizeResult = {
  candidateId: string;
  /** The candidate plus every record merged into them. */
  records: number;
  /** Rows deleted or erased, by kind. */
  removed: Record<string, number>;
  /** Files whose contents were removed from storage. */
  filesRemoved: number;
  /** "removed", "none" (there were no files), or "failed" (the database is erased; the stored files were not). */
  storage: "removed" | "none" | "failed";
};

/**
 * GDPR erasure, for an admin, irreversible: the candidate's personal data and
 * that of every record merged into them. `confirm` must be "ANONYMIZE <their
 * name>". The applications, stages, dates, interviews and ratings stay, with
 * the person named "Anonymized candidate". The audit row records the action
 * and counts, never what was erased.
 */
export async function anonymizeCandidate(
  db: Db,
  ctx: ClientToolCtx,
  store: FileStore | null,
  input: { candidateId: string; confirm: string },
): Promise<AnonymizeResult> {
  if (ctx.accessLevel !== "admin") throw adminsOnly("anonymize a candidate");
  const person = (await readPeople(db, [input.candidateId])).get(input.candidateId);
  if (!person) throw notFound();
  if (person.anonymized_at) throw new ClientToolError("invalid", "That candidate was already anonymized. Nothing was changed.");
  // The refusal never repeats the name: it goes back unfenced.
  if (normalizeConfirm(input.confirm) !== confirmationFor(person)) throw new ClientToolError("invalid", confirmHelp());

  // Files are erased from Storage too: without a way to remove them, erase nothing.
  const { count, error: countError } = await db
    .from("person_files").select("id", { count: "exact", head: true }).eq("person_id", input.candidateId);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) > 0 && !store?.remove) {
    throw new ClientToolError(
      "forbidden",
      "This candidate has files, and this Tacit deployment cannot delete stored files yet, so nothing was erased. Ask Tacit to help.",
    );
  }

  return withAudit(db, ctx, { action: "person.anonymize", entity: "person" }, async () => {
    const { data, error } = await db.rpc("client_anonymize_candidate", { p_person: input.candidateId, p_confirm: input.confirm });
    if (error) throw refusal(error, "anonymize") ?? new Error(error.message);
    const r = data as unknown as { anonymized: number; removed: Record<string, number>; storage_paths: string[] | null };
    const paths = r.storage_paths ?? [];
    let storage: AnonymizeResult["storage"] = "none";
    if (paths.length) {
      // The rows are gone and committed: a failure here leaves bytes no row points at.
      try {
        if (!store?.remove) throw new Error("no file store");
        await store.remove(paths);
        storage = "removed";
      } catch (err) {
        // The paths are ids only (<org>/<person>/<file>), safe to log for a manual clean-up.
        console.error(`[client-tools] anonymize ${input.candidateId}: stored files not removed: ${paths.join(", ")}`, err);
        storage = "failed";
      }
    }
    const result: AnonymizeResult = {
      candidateId: input.candidateId,
      records: r.anonymized,
      removed: r.removed ?? {},
      filesRemoved: storage === "removed" ? paths.length : 0,
      storage,
    };
    return {
      result,
      entityId: input.candidateId,
      // No name, no confirmation text, no paths: what was done, not to whom by name.
      after: { records: result.records, removed: result.removed, storage, files: paths.length },
      changed: true,
    };
  });
}
