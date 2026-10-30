import { IN_PROCESS_STAGES } from "@tacit/core";

// The CRM table (design/tats's #crm): one row per candidate the member can
// see, with the jobs they are in, where they stand, the owner and the last
// touch. Views, search, sorting and paging are computed here from what
// lib/client/crm.ts read; nothing is stored. Pure: the page reads, this sorts.

export const CRM_VIEWS = [
  { key: "all", label: "All" },
  { key: "active", label: "In process" },
  { key: "hired", label: "Hired" },
  { key: "rejected", label: "Rejected" },
  { key: "withdrew", label: "Withdrew" },
] as const;

export type CrmView = (typeof CRM_VIEWS)[number]["key"];

/** The stages that put an application in a view; `all` takes every application, and candidates in none. */
const VIEW_STAGES: Record<Exclude<CrmView, "all">, readonly string[]> = {
  active: IN_PROCESS_STAGES,
  hired: ["hired"],
  rejected: ["rejected"],
  withdrew: ["withdrawn"],
};

export const CRM_SORTS = ["name", "job", "stage", "owner", "last"] as const;
export type CrmSort = (typeof CRM_SORTS)[number];
export type SortDir = "asc" | "desc";

/** A column's first click: names A to Z, the newest touch first. */
export const DEFAULT_DIR: Record<CrmSort, SortDir> = { name: "asc", job: "asc", stage: "asc", owner: "asc", last: "desc" };

export const CRM_PAGE_SIZE = 50;

export const STAGE_LABELS: Record<string, string> = {
  sourced: "Sourced",
  contacted: "Contacted",
  screening: "Screening",
  interviewing: "Interviewing",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrew",
};

export const stageLabel = (stage: string | null) => (stage === null ? "Prospect" : (STAGE_LABELS[stage] ?? stage.replace(/_/g, " ")));

export type CrmApplication = {
  applicationId: string;
  jobId: string;
  jobTitle: string | null;
  stage: string;
  ownerName: string | null;
  lastTouchAt: string;
};

export type CrmCandidate = {
  candidateId: string;
  name: string | null;
  headline: string | null;
  email: string | null;
  addedAt: string;
  applications: CrmApplication[];
};

export type CrmRow = {
  candidateId: string;
  name: string;
  headline: string | null;
  /** The jobs this row is about, the lead one first. */
  jobs: { jobId: string; title: string }[];
  /** The lead application's stage; null for a prospect, in no job the member can see. */
  stage: string | null;
  ownerName: string | null;
  /** The newest touch on any of their applications, or when they were added. */
  lastTouchAt: string;
};

/** Furthest along first, then the outcomes: a candidate's lead application is the one that says most. */
const STAGE_RANK: Record<string, number> = { offer: 0, interviewing: 1, screening: 2, contacted: 3, sourced: 4, hired: 5, rejected: 6, withdrawn: 6 };
const rank = (stage: string | null) => (stage === null ? 9 : (STAGE_RANK[stage] ?? 8));
const LIVE = new Set(["sourced", "contacted", ...IN_PROCESS_STAGES]);

const byLead = (a: CrmApplication, b: CrmApplication) => rank(a.stage) - rank(b.stage) || Date.parse(b.lastTouchAt) - Date.parse(a.lastTouchAt);

/**
 * The candidate's row in a view, or null when they are not in it. In a view
 * the row is about the applications that put them there; in All, about the
 * live ones, or the lead application once nothing is live.
 */
export function rowFor(c: CrmCandidate, view: CrmView): CrmRow | null {
  const apps = (view === "all" ? c.applications : c.applications.filter((a) => VIEW_STAGES[view].includes(a.stage))).slice().sort(byLead);
  if (view !== "all" && apps.length === 0) return null;
  const lead = apps[0] ?? null;
  const shown = view === "all" ? (apps.some((a) => LIVE.has(a.stage)) ? apps.filter((a) => LIVE.has(a.stage)) : apps.slice(0, 1)) : apps;
  const jobs: CrmRow["jobs"] = [];
  for (const a of shown) if (!jobs.some((j) => j.jobId === a.jobId)) jobs.push({ jobId: a.jobId, title: a.jobTitle ?? "Untitled job" });
  const touches = c.applications.map((a) => Date.parse(a.lastTouchAt));
  return {
    candidateId: c.candidateId,
    name: c.name?.trim() || "Unnamed",
    headline: c.headline,
    jobs,
    stage: lead?.stage ?? null,
    ownerName: lead?.ownerName ?? null,
    lastTouchAt: touches.length ? new Date(Math.max(...touches)).toISOString() : c.addedAt,
  };
}

/** Name, email, headline or a job title containing every word of the search. */
export function matches(c: CrmCandidate, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [c.name, c.email, c.headline, ...c.applications.map((a) => a.jobTitle)].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

const text = (s: string | null | undefined) => (s ?? "").toLocaleLowerCase();

/** Sorted by one column; a row with nothing in that column goes last either way, then by name. */
export function sortRows(rows: CrmRow[], sort: CrmSort, dir: SortDir): CrmRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const key = (r: CrmRow): string | number | null => {
    switch (sort) {
      case "name":
        return text(r.name);
      case "job":
        return r.jobs[0] ? text(r.jobs[0].title) : null;
      case "stage":
        return r.stage === null ? null : rank(r.stage);
      case "owner":
        return r.ownerName ? text(r.ownerName) : null;
      case "last":
        return Date.parse(r.lastTouchAt);
    }
  };
  return rows
    .map((r) => ({ r, k: key(r) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? text(a.r.name).localeCompare(text(b.r.name)) : a.k === null ? 1 : -1;
      const d = typeof a.k === "number" && typeof b.k === "number" ? a.k - b.k : String(a.k).localeCompare(String(b.k));
      return d * sign || text(a.r.name).localeCompare(text(b.r.name));
    })
    .map(({ r }) => r);
}

export type CrmQuery = { view: CrmView; q: string; sort: CrmSort; dir: SortDir; page: number };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The URL's view, search, sort and page, anything unknown falling back to the default. */
export function parseCrmQuery(sp: Record<string, string | string[] | undefined>): CrmQuery {
  const view = CRM_VIEWS.find((v) => v.key === one(sp.view))?.key ?? "all";
  const sort = (CRM_SORTS as readonly string[]).includes(one(sp.sort)) ? (one(sp.sort) as CrmSort) : "last";
  const dir = one(sp.dir) === "asc" || one(sp.dir) === "desc" ? (one(sp.dir) as SortDir) : DEFAULT_DIR[sort];
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  return { view, q: one(sp.q).trim().slice(0, 100), sort, dir, page };
}

/** The URL for a query, leaving defaults out. */
export function crmHref(q: CrmQuery): string {
  const params = new URLSearchParams();
  if (q.view !== "all") params.set("view", q.view);
  if (q.q) params.set("q", q.q);
  if (q.sort !== "last") params.set("sort", q.sort);
  if (q.dir !== DEFAULT_DIR[q.sort]) params.set("dir", q.dir);
  if (q.page > 1) params.set("page", String(q.page));
  const qs = params.toString();
  return `/client/candidates${qs ? `?${qs}` : ""}`;
}

export type CrmTable = {
  /** Candidates in each view, after the search. */
  counts: Record<CrmView, number>;
  total: number;
  page: number;
  pages: number;
  rows: CrmRow[];
};

/** Everything the table shows for a query: each view's count, and the page of sorted rows. */
export function crmTable(candidates: CrmCandidate[], q: CrmQuery): CrmTable {
  const found = candidates.filter((c) => matches(c, q.q));
  const counts = Object.fromEntries(CRM_VIEWS.map((v) => [v.key, 0])) as Record<CrmView, number>;
  let rows: CrmRow[] = [];
  for (const c of found) {
    for (const v of CRM_VIEWS) {
      const row = rowFor(c, v.key);
      if (!row) continue;
      counts[v.key] += 1;
      if (v.key === q.view) rows.push(row);
    }
  }
  rows = sortRows(rows, q.sort, q.dir);
  const pages = Math.max(1, Math.ceil(rows.length / CRM_PAGE_SIZE));
  const page = Math.min(q.page, pages);
  return { counts, total: rows.length, page, pages, rows: rows.slice((page - 1) * CRM_PAGE_SIZE, page * CRM_PAGE_SIZE) };
}
