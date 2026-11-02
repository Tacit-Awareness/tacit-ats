import { hrefAt } from "./home-tabs";
import { IN_PROCESS_STAGES, SOURCE_DETAIL_MAX } from "@tacit/core";
import { stageLabel } from "./crm-views";

// The Referrals table (design/tats's #referrals): every application whose
// source is `referral` that the member can read, open and closed, with who
// referred them and where they are now. Tabs, search and paging are computed
// here from what lib/client/referrals.ts read; nothing is stored. Pure: the
// page reads, this arranges.
//
// "Referred by" is the application's `source_detail` as it was typed: free
// text, untrusted, never matched to a member. The "Top referrers" board beside
// the table counts by it (lib/client/top-referrers.ts).

export const REFERRAL_TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "In process" },
  { key: "hired", label: "Hired" },
  { key: "closed", label: "Closed" },
] as const;

export type ReferralTab = (typeof REFERRAL_TABS)[number]["key"];

const CLOSED = ["rejected", "withdrawn"];

/** The stages that put a referral in a tab; `all` takes every one. */
export function inTab(stage: string, tab: ReferralTab): boolean {
  switch (tab) {
    case "all":
      return true;
    case "active":
      return IN_PROCESS_STAGES.includes(stage as (typeof IN_PROCESS_STAGES)[number]);
    case "hired":
      return stage === "hired";
    case "closed":
      return CLOSED.includes(stage);
  }
}

export const REFERRAL_PAGE_SIZE = 50;

export type Referral = {
  applicationId: string;
  candidateId: string;
  name: string | null;
  /** `source_detail`, as given. */
  referredBy: string | null;
  jobId: string;
  jobTitle: string | null;
  stage: string;
  /** When the application was made: when they were referred. */
  referredAt: string;
};

/** How a stage reads in the "Where they are" column (the CRM's words), and its pill's colour. */
export function whereTheyAre(stage: string): { label: string; tone: "green" | "grey" } {
  return { label: stageLabel(stage), tone: stage === "hired" ? "green" : "grey" };
}

/** Candidate, referrer or job containing every word of the search. */
export function matches(r: Referral, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [r.name, r.referredBy, r.jobTitle].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

export type ReferralQuery = { tab: ReferralTab; q: string; page: number };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The URL's tab, search and page, anything unknown falling back to the default. */
export function parseReferralQuery(sp: Record<string, string | string[] | undefined>): ReferralQuery {
  const tab = REFERRAL_TABS.find((t) => t.key === one(sp.tab))?.key ?? "all";
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  return { tab, q: one(sp.q).trim().slice(0, 100), page };
}

/** The URL for a query, leaving defaults out. */
export function referralsHref(q: ReferralQuery, base = "/client/referrals"): string {
  const params = new URLSearchParams();
  if (q.tab !== "all") params.set("tab", q.tab);
  if (q.q) params.set("q", q.q);
  if (q.page > 1) params.set("page", String(q.page));
  return hrefAt(base, params);
}

export type ReferralTable = {
  /** Referrals in each tab, after the search. */
  counts: Record<ReferralTab, number>;
  total: number;
  page: number;
  pages: number;
  rows: Referral[];
};

/** Everything the table shows for a query: each tab's count, and the page of rows, newest referral first. */
export function referralTable(referrals: Referral[], q: ReferralQuery): ReferralTable {
  const found = referrals.filter((r) => matches(r, q.q));
  const counts = Object.fromEntries(REFERRAL_TABS.map((t) => [t.key, found.filter((r) => inTab(r.stage, t.key)).length])) as Record<ReferralTab, number>;
  const rows = found
    .filter((r) => inTab(r.stage, q.tab))
    .sort((a, b) => Date.parse(b.referredAt) - Date.parse(a.referredAt) || a.applicationId.localeCompare(b.applicationId));
  const pages = Math.max(1, Math.ceil(rows.length / REFERRAL_PAGE_SIZE));
  const page = Math.min(q.page, pages);
  return { counts, total: rows.length, page, pages, rows: rows.slice((page - 1) * REFERRAL_PAGE_SIZE, page * REFERRAL_PAGE_SIZE) };
}

/**
 * The "Referred by" typed into the add form, as it is stored in
 * `source_detail`: whitespace collapsed, at most SOURCE_DETAIL_MAX; null when
 * empty or too long, so the form says so instead of cutting a name short.
 */
export function cleanReferrer(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, " ");
  return v && v.length <= SOURCE_DETAIL_MAX ? v : null;
}
