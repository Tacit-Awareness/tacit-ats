// The Interviews page's groups, computed, not stored: Upcoming, then the past
// ones by how they went, as design/tats's Interviews (Pass, Mixed, Fail, Read
// pending). A verdict is the filed feedback's recommendations the member may
// read: every one a yes is a pass, every one a no a fail, both a mix, none
// read pending. Pure, so the page and the tests share it.

export type Recommendation = "strong_yes" | "yes" | "no" | "strong_no";
export type Verdict = "pass" | "mixed" | "fail" | "pending";
export type GroupKey = "upcoming" | Verdict;

export const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "pass", label: "Pass" },
  { key: "mixed", label: "Mixed" },
  { key: "fail", label: "Fail" },
  { key: "pending", label: "Read pending" },
];

export const VERDICT_LABEL: Record<Verdict, string> = { pass: "Pass", mixed: "Mixed", fail: "Fail", pending: "Read pending" };

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  no: "No",
  strong_no: "Strong no",
};

const isYes = (r: string) => r === "yes" || r === "strong_yes";

export function verdictOf(recommendations: readonly string[]): Verdict {
  if (!recommendations.length) return "pending";
  const yes = recommendations.filter(isYes).length;
  if (yes === recommendations.length) return "pass";
  if (yes === 0) return "fail";
  return "mixed";
}

export type GroupInput = { interviewId: string; startsAt: string; endsAt: string; status: string; recommendations: readonly string[] };

/**
 * Upcoming: still scheduled and not yet over, soonest first. Everything else
 * that was not cancelled is past, grouped by its verdict, newest first. A
 * `scheduled` interview past its end counts as held, as on the Pipeline board.
 */
export function groupOf(i: GroupInput, now: number): GroupKey | null {
  if (i.status === "cancelled") return null;
  if (i.status === "scheduled" && Date.parse(i.endsAt) >= now) return "upcoming";
  return verdictOf(i.recommendations);
}

export type Grouped<T> = { key: GroupKey; label: string; items: T[] }[];

/** The non-empty groups in page order, each sorted. */
export function groupInterviews<T extends GroupInput>(items: readonly T[], now: number): Grouped<T> {
  const by = new Map<GroupKey, T[]>();
  for (const i of items) {
    const key = groupOf(i, now);
    if (!key) continue;
    by.set(key, [...(by.get(key) ?? []), i]);
  }
  return GROUPS.flatMap(({ key, label }) => {
    const list = by.get(key);
    if (!list) return [];
    const sorted = [...list].sort((a, b) =>
      key === "upcoming" ? Date.parse(a.startsAt) - Date.parse(b.startsAt) : Date.parse(b.startsAt) - Date.parse(a.startsAt),
    );
    return [{ key, label, items: sorted }];
  });
}
