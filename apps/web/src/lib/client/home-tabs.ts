// Home's tabs (design/tats's `#home~tickets`): Applicant Tickets, Interviews and
// Referrals draw inside Home under `?sub=`, and their own routes stay. A page
// drawn in either place builds its links from a base, so a link or a redirect
// never drops a member out of the tab. Pure, unit-tested.

export const HOME_SUBS = ["tickets", "interviews", "referrals"] as const;
export type HomeSub = (typeof HOME_SUBS)[number];

export const parseHomeSub = (v: string): HomeSub | null => (HOME_SUBS as readonly string[]).find((s) => s === v) as HomeSub | undefined ?? null;

export const homeSubBase = (sub: HomeSub) => `/client?sub=${sub}`;

/** A page's link: its base, which may carry `?sub=` already, and the params. */
export function hrefAt(base: string, params: URLSearchParams): string {
  const qs = params.toString();
  if (!qs) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${qs}`;
}
