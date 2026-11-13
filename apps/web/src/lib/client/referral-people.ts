import { hrefAt } from "./home-tabs";
import { REFERRAL_PAGE_SIZE, REFERRAL_TABS, inTab, matches, parseReferralQuery, referrerName, type Referral, type ReferralQuery, type ReferralTab } from "./referral-table";

// Referrals as a CRM of the people referred in: one row per person, the way
// the CRM (lib/client/crm-views.ts) has one per candidate, with who referred
// them, the job, where they are now and when. A person referred to two jobs
// is one row, about their lead referral: the one furthest along, then the
// newest. Tabs, search, sorting and paging are worked out here from what
// lib/client/referrals.ts read, on referral-table.ts's tabs, search and page;
// nothing is stored. Pure: the page reads, this arranges.

export const REFERRAL_SORTS = ["name", "referrer", "job", "stage", "when"] as const;
export type ReferralSort = (typeof REFERRAL_SORTS)[number];
export type SortDir = "asc" | "desc";

/** Each column's first direction: names A to Z, the newest referral first. */
export const REFERRAL_DEFAULT_DIR: Record<ReferralSort, SortDir> = { name: "asc", referrer: "asc", job: "asc", stage: "asc", when: "desc" };

export type ReferralPeopleQuery = ReferralQuery & { sort: ReferralSort; dir: SortDir };

/** One referred person: their lead referral's facts, and every job they were referred to. */
export type ReferredPerson = {
  candidateId: string;
  name: string | null;
  referredBy: string | null;
  /** The jobs this row is about, the lead one first. */
  jobs: string[];
  stage: string;
  /** The newest referral among them. */
  referredAt: string;
  applicationId: string;
};

/** Furthest along first, then the outcomes, as the CRM ranks a candidate's lead application. */
const STAGE_RANK: Record<string, number> = { offer: 0, interviewing: 1, screening: 2, contacted: 3, sourced: 4, hired: 5, rejected: 6, withdrawn: 6 };
const rank = (stage: string) => STAGE_RANK[stage] ?? 8;
const byLead = (a: Referral, b: Referral) => rank(a.stage) - rank(b.stage) || Date.parse(b.referredAt) - Date.parse(a.referredAt);

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The URL's tab, search, sort and page, anything unknown falling back to the default. */
export function parseReferralPeopleQuery(sp: Record<string, string | string[] | undefined>): ReferralPeopleQuery {
  const sort = (REFERRAL_SORTS as readonly string[]).includes(one(sp.sort)) ? (one(sp.sort) as ReferralSort) : "when";
  const dir = one(sp.dir) === "asc" || one(sp.dir) === "desc" ? (one(sp.dir) as SortDir) : REFERRAL_DEFAULT_DIR[sort];
  return { ...parseReferralQuery(sp), sort, dir };
}

/** The URL for a query, leaving defaults out. */
export function referralPeopleHref(q: ReferralPeopleQuery, base = "/client/referrals"): string {
  const params = new URLSearchParams();
  if (q.tab !== "all") params.set("tab", q.tab);
  if (q.q) params.set("q", q.q);
  if (q.sort !== "when") params.set("sort", q.sort);
  if (q.dir !== REFERRAL_DEFAULT_DIR[q.sort]) params.set("dir", q.dir);
  if (q.page > 1) params.set("page", String(q.page));
  return hrefAt(base, params);
}

/** A person's row in a tab, about the referrals that put them there; null when none does. */
function personIn(referrals: Referral[], tab: ReferralTab): ReferredPerson | null {
  const apps = referrals.filter((r) => inTab(r.stage, tab)).sort(byLead);
  const lead = apps[0];
  if (!lead) return null;
  return {
    candidateId: lead.candidateId,
    name: lead.name,
    referredBy: lead.referredBy,
    jobs: [...new Set(apps.map((a) => a.jobTitle ?? "Untitled job"))],
    stage: lead.stage,
    referredAt: apps.reduce((max, a) => (Date.parse(a.referredAt) > Date.parse(max) ? a.referredAt : max), lead.referredAt),
    applicationId: lead.applicationId,
  };
}

const text = (s: string | null | undefined) => (s ?? "").toLocaleLowerCase();

/** Sorted by one column; a row with nothing in it goes last either way, then by name. */
export function sortPeople(rows: ReferredPerson[], sort: ReferralSort, dir: SortDir): ReferredPerson[] {
  const sign = dir === "asc" ? 1 : -1;
  const key = (r: ReferredPerson): string | number | null => {
    switch (sort) {
      case "name":
        return r.name?.trim() ? text(r.name) : null;
      case "referrer":
        // By the name the column shows, so "Backchannel from Daniel" sorts under D.
        return r.referredBy?.trim() ? text(referrerName(r.referredBy)) : null;
      case "job":
        return r.jobs[0] ? text(r.jobs[0]) : null;
      case "stage":
        return rank(r.stage);
      case "when":
        return Date.parse(r.referredAt);
    }
  };
  return rows
    .map((r) => ({ r, k: key(r) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? text(a.r.name).localeCompare(text(b.r.name)) : a.k === null ? 1 : -1;
      const d = typeof a.k === "number" && typeof b.k === "number" ? a.k - b.k : String(a.k).localeCompare(String(b.k));
      return d * sign || text(a.r.name).localeCompare(text(b.r.name)) || a.r.applicationId.localeCompare(b.r.applicationId);
    })
    .map(({ r }) => r);
}

export type ReferralPeopleTable = {
  /** People in each tab, after the search. */
  counts: Record<ReferralTab, number>;
  /** Everyone referred, whatever the tab or search: the title's count. */
  everyone: number;
  total: number;
  page: number;
  pages: number;
  rows: ReferredPerson[];
};

/** Everything the table shows for a query: each tab's count of people, and the page of sorted rows. */
export function referralPeople(referrals: Referral[], q: ReferralPeopleQuery): ReferralPeopleTable {
  const byPerson = new Map<string, Referral[]>();
  for (const r of referrals) byPerson.set(r.candidateId, [...(byPerson.get(r.candidateId) ?? []), r]);
  // A person matches when any of their referrals does: their name, a referrer, a job.
  const found = [...byPerson.values()].filter((apps) => apps.some((r) => matches(r, q.q)));
  const counts = Object.fromEntries(REFERRAL_TABS.map((t) => [t.key, found.filter((apps) => apps.some((r) => inTab(r.stage, t.key))).length])) as Record<ReferralTab, number>;
  const rows = sortPeople(
    found.map((apps) => personIn(apps, q.tab)).filter((p): p is ReferredPerson => p !== null),
    q.sort,
    q.dir,
  );
  const pages = Math.max(1, Math.ceil(rows.length / REFERRAL_PAGE_SIZE));
  const page = Math.min(q.page, pages);
  return { counts, everyone: byPerson.size, total: rows.length, page, pages, rows: rows.slice((page - 1) * REFERRAL_PAGE_SIZE, page * REFERRAL_PAGE_SIZE) };
}
