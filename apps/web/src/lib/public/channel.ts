// Where a public job post's reader came from (design/tats's LinkedIn and Hacker
// News channels, widened by tacit-internal's 20261030240000_wider_channels):
// one of submit_job_application's nine categories, worked out where they land and
// nothing else kept. The Referer is read once, on the server, and thrown away:
// no address, path or tag is stored, logged or sent anywhere.
//
// The form posts from this app, so a Referer at apply time only ever names the
// app itself. So the channel is worked out on the landing page and rides in the
// URL (`?via=`) through the tabs, the board, the form's action and the redirect
// back after an error: no cookie, no storage, no script. Direct is what a
// missing `via` means, so an ordinary link stays clean.
//
// Pure, so the board's client component can build its links with it. A wrong
// value is no channel and never stops an application.

export const CHANNELS = ["linkedin", "hackernews", "indeed", "wellfound", "x", "blind", "google", "direct", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

/** The URL parameter a channel rides in once it has been worked out. */
export const VIA = "via";

export function parseChannel(raw: unknown): Channel | null {
  return typeof raw === "string" && (CHANNELS as readonly string[]).includes(raw) ? (raw as Channel) : null;
}

type Query = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** A tag on a shared link, as a team writes one: `?utm_source=linkedin`, `?ref=hn`. */
const TAG_PARAMS = ["utm_source", "ref", "source"];
const TAG_SETS: ReadonlyArray<[Channel, ReadonlySet<string>]> = [
  ["linkedin", new Set(["linkedin", "linkedin.com", "lnkd", "lnkd.in", "li"])],
  ["hackernews", new Set(["hn", "hackernews", "hacker_news", "hacker-news", "hacker news", "ycombinator", "news.ycombinator.com"])],
  ["indeed", new Set(["indeed", "indeed.com"])],
  ["wellfound", new Set(["wellfound", "wellfound.com", "angellist", "angel.co", "angel", "talent"])],
  ["x", new Set(["x", "x.com", "twitter", "twitter.com", "t.co", "tweet"])],
  ["blind", new Set(["blind", "teamblind", "teamblind.com"])],
  ["google", new Set(["google", "google.com", "google_jobs", "googlejobs"])],
];

function tagChannel(tag: string): Channel {
  for (const [channel, tags] of TAG_SETS) if (tags.has(tag)) return channel;
  return "other";
}

const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Another site's Referer as a channel; none, an unreadable one or this app's own is direct. */
function referrerChannel(referrer: string | null, ownHost: string | null): Channel {
  if (!referrer) return "direct";
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return "direct";
  }
  const host = url.hostname.toLowerCase();
  if (!host || url.host.toLowerCase() === ownHost?.toLowerCase()) return "direct";
  // LinkedIn's Android app names itself; its short links are lnkd.in.
  if (onHost(host, "linkedin.com") || onHost(host, "lnkd.in") || host === "com.linkedin.android") return "linkedin";
  if (host === "news.ycombinator.com" || host === "hn.algolia.com") return "hackernews";
  if (onHost(host, "indeed.com")) return "indeed";
  if (onHost(host, "wellfound.com") || onHost(host, "angel.co")) return "wellfound";
  if (onHost(host, "x.com") || onHost(host, "twitter.com") || onHost(host, "t.co")) return "x";
  if (onHost(host, "teamblind.com")) return "blind";
  if (onHost(host, "google.com") || onHost(host, "googlejobs.com")) return "google";
  return "other";
}

/**
 * A page's channel: one already worked out (`via`), then a tag on the link,
 * since an in-app browser often sends no Referer, then the Referer.
 */
export function landingChannel(query: Query, referrer: string | null, ownHost: string | null): Channel {
  const carried = parseChannel(first(query[VIA]));
  if (carried) return carried;
  for (const param of TAG_PARAMS) {
    const tag = first(query[param])?.trim().toLowerCase();
    if (tag) return tagChannel(tag);
  }
  return referrerChannel(referrer, ownHost);
}

/** A public link carrying the channel; direct needs none. */
export function withVia(href: string, channel: Channel): string {
  return channel === "direct" ? href : `${href}${href.includes("?") ? "&" : "?"}${VIA}=${channel}`;
}
