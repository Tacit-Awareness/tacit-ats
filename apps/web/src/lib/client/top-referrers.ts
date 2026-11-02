import { inTab, type Referral } from "./referral-table";

// Referrals' "Top referrers" board (design/tats's `.ref-side`): who referred
// the most of the referrals the member can read, with how many are in
// process and how many were hired. Pure: the page reads (lib/client/referrals.ts),
// this counts. Nothing is stored.
//
// A referrer is the application's `source_detail`, free text as typed, never
// matched to a member: there is no referrer column (tacit-internal owns the
// schema). So a referrer here is a spelling, folded only where it cannot be
// two people: case, whitespace and Unicode form. "Sam" and "Sam Lee" stay
// two rows. The add form offers the team's full names, so most agree.

/** Rows the board shows; past it the rest are counted in `more`. */
export const TOP_REFERRERS_MAX = 10;

export type TopReferrer = {
  /** The spelling typed most often, the earliest on a tie. */
  name: string;
  referred: number;
  /** In process as the table's tab counts it: screening, interviewing, offer. */
  inProcess: number;
  hired: number;
};

export type TopReferrers = { rows: TopReferrer[]; more: number };

/** What two spellings of one referrer share: NFC, whitespace collapsed, case folded. */
export function referrerKey(raw: string | null): string | null {
  const v = raw?.normalize("NFC").trim().replace(/\s+/g, " ");
  return v ? v.toLocaleLowerCase("en-US") : null;
}

/**
 * Every referrer with a name, most hired first, then most referred, then by
 * name; at most `max`. A referral with no referrer is left out, as the
 * prototype leaves out "Unknown".
 */
export function topReferrers(referrals: Referral[], max = TOP_REFERRERS_MAX): TopReferrers {
  const groups = new Map<string, { spellings: Map<string, { n: number; first: number }>; referred: number; inProcess: number; hired: number }>();
  for (const r of referrals) {
    const key = referrerKey(r.referredBy);
    if (!key) continue;
    const g = groups.get(key) ?? { spellings: new Map(), referred: 0, inProcess: 0, hired: 0 };
    groups.set(key, g);
    const spelling = r.referredBy!.normalize("NFC").trim().replace(/\s+/g, " ");
    const at = Date.parse(r.referredAt);
    const s = g.spellings.get(spelling);
    if (s) {
      s.n++;
      s.first = Math.min(s.first, at);
    } else g.spellings.set(spelling, { n: 1, first: at });
    g.referred++;
    if (inTab(r.stage, "active")) g.inProcess++;
    if (inTab(r.stage, "hired")) g.hired++;
  }
  const all = [...groups.values()].map((g) => {
    const [name] = [...g.spellings].sort(([a, x], [b, y]) => y.n - x.n || x.first - y.first || a.localeCompare(b))[0]!;
    return { name, referred: g.referred, inProcess: g.inProcess, hired: g.hired };
  });
  all.sort((a, b) => b.hired - a.hired || b.referred - a.referred || a.name.localeCompare(b.name, "en-US"));
  return { rows: all.slice(0, max), more: Math.max(0, all.length - max) };
}
