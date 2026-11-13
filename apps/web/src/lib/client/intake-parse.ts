// What the intake composer understood from what someone wrote or pasted
// ("Maya Chen, maya@acme.com, linkedin.com/in/maya-chen. Met her at the infra
// meetup, strong on queues"): the name, the email, the LinkedIn profile, the
// job, for a referral who referred them, and the rest as the note. Pure and
// small enough for the browser, so the chips under the box follow every key.
// It only suggests: each chip can be corrected, the server checks everything
// again (core's parseCandidateIdentity), and nothing here is ever markup.

export type IntakeJob = { jobId: string; title: string };

export type Understood = {
  name: string | null;
  email: string | null;
  /** As written; core makes it canonical. */
  linkedinUrl: string | null;
  /** A job the text names, else null (the composer falls back to the one in view). */
  jobId: string | null;
  /** "referred by …" in the text, matched to a teammate's full name where one fits; null when the text doesn't say. */
  referredBy: string | null;
  /** Everything else, tidied: what goes on the application as its note. */
  note: string;
};

const EMAIL = /(?:mailto:)?([a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/i;
const LINKEDIN = /(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/(?:in|pub)\/[^\s,;<>()"'|]+/i;
const REFERRED = /\b(?:referred|referral|intro(?:duced)?)\s+(?:by|from)\s+/i;

/** Words that start a sentence, never a name: "Met her at…", "Strong on queues", "Hi". */
const NOT_NAME = new Set(
  (
    "a an the and or but of to in on at for from with by as is was are were be been has had have it its this that these those " +
    "i me my we our you your he him his she her they them their who what when where why how " +
    "met meet saw know knew worked works working work talked spoke referred referral refer intro introduced please add new " +
    "strong great good solid excellent amazing awesome smart senior junior staff principal lead candidate applicant " +
    "hi hey hello thanks thank re fwd fw note notes name email linkedin profile resume cv phone"
  ).split(" "),
);

const isNameWord = (w: string) => /^\p{L}[\p{L}'’.-]*$/u.test(w) && !NOT_NAME.has(w.toLowerCase().replace(/[.’']+$/, ""));

/** "maya chen" → "Maya Chen"; a name written with any capital stays as written. */
function cased(name: string): string {
  if (name !== name.toLowerCase()) return name;
  return name.replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Lower-case parts of a name ("Ludwig van Beethoven", "Ana de Souza"). */
const PARTICLES = new Set(["van", "von", "de", "da", "di", "del", "della", "der", "den", "du", "dos", "das", "la", "le", "ten", "ter", "bin", "binti", "al", "el", "y"]);

/**
 * The leading words, when they read as a name: one to four words of letters,
 * up to the first comma, line, bracket, colon, dash or address. A "Name:"
 * label in front is skipped. Written with capitals, every word but a particle
 * starts with one ("Infra meetup" is no name). `cut` says the name stands on
 * its own, so the note can start after it; a name that runs into a sentence
 * ("Maya Chen is great on queues") stays in the note too.
 */
function leadingName(text: string): { name: string; end: number; cut: boolean } | null {
  const label = /^\s*(?:full\s+)?name\s*[:\-–]\s*/i.exec(text);
  const from = label ? label[0].length : text.length - text.trimStart().length;
  const said: string[] = [];
  const re = /\S+/g;
  re.lastIndex = from;
  let end = from;
  let cut = true;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // A new line ends it.
    if (said.length && text.slice(end, m.index).includes("\n")) break;
    let w = m[0];
    if (/[@/]|^(?:https?:|www\.)/i.test(w) || /^[(<|–—-]/.test(w)) break;
    // "Chen," "Chen." "Chen:" "Chen;" close the name; an initial ("J.") doesn't.
    const closes = /[,;:)]$/.test(w) || (/\.$/.test(w) && !/^\p{L}\.$/u.test(w));
    if (closes) w = w.replace(/[,;:.)]+$/, "");
    if (!w || !isNameWord(w)) {
      // Two words and then a sentence: the name, left where it is.
      if (said.length >= 2) {
        cut = false;
        break;
      }
      return null;
    }
    said.push(w);
    end = m.index + m[0].length;
    if (said.length > 4) return null;
    if (closes) break;
  }
  if (!said.length) return null;
  if (said.some((w) => /^\p{Lu}/u.test(w)) && !said.every((w) => /^\p{Lu}/u.test(w) || PARTICLES.has(w.toLowerCase()))) return null;
  const name = said.join(" ");
  return name.replace(/[.'’-]/g, "").length >= 2 ? { name: cased(name), end, cut } : null;
}

/** LinkedIn's slug as a name, its disambiguating suffix dropped ("maya-chen-4a5b12" → "Maya Chen"); two parts or none, as core's callers ask. */
export function nameFromSlug(url: string): string | null {
  const slug = /\/(?:in|pub)\/([^/?#\s]+)/i.exec(url)?.[1];
  if (!slug) return null;
  let raw = slug;
  try {
    raw = decodeURIComponent(slug);
  } catch {
    // Kept as written.
  }
  const parts = raw
    .split(/[-_.]+/)
    .map((t) => {
      if (!/\d/.test(t)) return t;
      const alpha = t.replace(/\d+$/, "");
      return alpha && !/\d/.test(alpha) && !/^[a-f]+$/i.test(alpha) ? alpha : "";
    })
    .filter((t) => /^\p{L}+$/u.test(t));
  if (parts.length < 2) return null;
  return parts.map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase()).join(" ");
}

/** "in/maya-chen" for a chip. */
export function profileLabel(url: string): string {
  const m = /linkedin\.com\/(in|pub)\/([^/?#\s]+)/i.exec(url);
  return m ? `${m[1]}/${m[2]}` : url.replace(/^https?:\/\/(www\.)?/i, "");
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Whether `phrase` appears in `hay` as whole words. Both already lowered and spaced by `words`. */
const has = (hay: string, phrase: string) => phrase !== "" && ` ${hay} `.includes(` ${phrase} `);

/** Where `phrase` (lowered and spaced by `words`) sits in the text as written: whole words, any punctuation between them. */
function spanOf(text: string, phrase: string): [number, number] | null {
  if (!phrase) return null;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${phrase.split(" ").join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])`, "iu");
  const m = re.exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}

/**
 * The job the text names. A title said whole wins ("Founding Engineer,
 * Infra"); then its role before the comma ("founding engineer"), helped by its
 * team said anywhere ("… for infra"). A tie goes to `prefer` (the job in view),
 * else to the first in the list. `span` is where the title was said.
 */
export function jobSaid(text: string, jobs: IntakeJob[], prefer: string | null = null): { jobId: string; span: [number, number] } | null {
  const hay = words(text);
  if (!hay) return null;
  let best: { jobId: string; score: number; said: string } | null = null;
  for (const j of jobs) {
    const [role = "", ...rest] = j.title.split(",");
    const whole = words(j.title);
    const head = words(role);
    const team = words(rest.join(" "));
    let score = 0;
    let said = whole;
    if (has(hay, whole)) score = 1000 + whole.length;
    else if (head.length >= 5 && has(hay, head)) {
      score = 500 + head.length + (team && team.split(" ").every((t) => has(hay, t)) ? 100 : 0);
      said = head;
    }
    if (!score) continue;
    if (!best || score > best.score || (score === best.score && j.jobId === prefer)) best = { jobId: j.jobId, score, said };
  }
  if (!best) return null;
  const span = spanOf(text, best.said);
  return span ? { jobId: best.jobId, span } : null;
}

export const jobInText = (text: string, jobs: IntakeJob[], prefer: string | null = null): string | null => jobSaid(text, jobs, prefer)?.jobId ?? null;

/**
 * A job title that stands on its own, at the end of what was written ("… great
 * on evals. Research Engineer, Evals") or on a line of its own, names the job
 * and nothing else, so it leaves the note: the cut covers it and the
 * punctuation after it. One inside a sentence ("for the founding engineer
 * role") stays.
 */
function aloneJob(text: string, span: [number, number]): [number, number] | null {
  const before = text.slice(0, span[0]);
  if (!/(?:^|[.!?,;:\n–—-])\s*$/.test(before)) return null;
  const after = /^[ \t.!?,;:)]*(?=\n|$)/.exec(text.slice(span[1]));
  return after ? [span[0], span[1] + after[0].length] : null;
}

/**
 * "referred by Sam" → the words after it that read as a name, up to four.
 * A teammate whose full or first name matches, uniquely, is named in full, so
 * Top referrers counts them once; "me" is the signed-in member.
 */
function referrerIn(text: string, teammates: string[], me: string | null): { name: string; start: number; end: number } | null {
  const m = REFERRED.exec(text);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length);
  const said: string[] = [];
  let used = 0;
  const re = /\S+/g;
  for (let w = re.exec(after); w && said.length < 4; w = re.exec(after)) {
    if (after.slice(used, w.index).includes("\n") && said.length) break;
    const closes = /[,;:.!?)]$/.test(w[0]);
    const word = w[0].replace(/[,;:.!?)]+$/, "");
    if (!word) break;
    if (/^(me|myself)$/i.test(word) && !said.length) {
      if (!me) return null;
      return { name: me, start: m.index, end: m.index + m[0].length + w.index + w[0].length };
    }
    if (!/^\p{L}[\p{L}'’.-]*$/u.test(word) || NOT_NAME.has(word.toLowerCase())) break;
    said.push(word);
    used = w.index + w[0].length;
    if (closes) break;
  }
  if (!said.length) return null;
  const typed = said.join(" ");
  const lower = typed.toLowerCase();
  const full = teammates.filter((t) => t.toLowerCase() === lower);
  const first = teammates.filter((t) => t.toLowerCase().split(/\s+/)[0] === lower);
  const name = full[0] ?? (first.length === 1 ? first[0]! : cased(typed));
  return { name, start: m.index, end: m.index + m[0].length + used };
}

/** The note: what is left once the name, the addresses and the referrer are taken out, with the commas and labels they leave behind. */
function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+/g, " ")
        .replace(/\b(?:e-?mail|linkedin(?: profile)?|profile|name|referred by)\s*:\s*(?=[,;|]|$)/gi, "")
        .replace(/\(\s*\)|<\s*>|\[\s*\]/g, "")
        .replace(/\s+([,;.!?])/g, "$1")
        .replace(/([,;|/–—-])(?:\s*[,;|/–—-])+/g, "$1")
        .replace(/[,;](?=\s*[.!?])/g, "")
        .replace(/^[\s,;:.|/–—-]+/, "")
        .replace(/[\s,;:|/–—-]+$/, "")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Everything the composer shows as chips. `kind` says whether "referred by"
 * is read (a referral) or left in the note (an applicant, whose note is theirs).
 */
export function understand(
  text: string,
  opts: { jobs: IntakeJob[]; preferJob?: string | null; kind: "applicant" | "referral"; teammates?: string[]; me?: string | null },
): Understood {
  const cuts: [number, number][] = [];
  const email = EMAIL.exec(text);
  if (email) cuts.push([email.index, email.index + email[0].length]);
  const li = LINKEDIN.exec(text);
  let linkedinUrl: string | null = null;
  if (li) {
    linkedinUrl = li[0].replace(/[.!?]+$/, "");
    cuts.push([li.index, li.index + linkedinUrl.length]);
  }
  const ref = opts.kind === "referral" ? referrerIn(text, opts.teammates ?? [], opts.me ?? null) : null;
  if (ref) cuts.push([ref.start, ref.end]);

  const job = jobSaid(text, opts.jobs, opts.preferJob ?? null);
  const jobCut = job ? aloneJob(text, job.span) : null;
  if (jobCut) cuts.push(jobCut);

  // A job title in front ("Research Engineer, Evals") is the job, not a name.
  const lead = leadingName(text);
  let name: string | null = null;
  if (lead && !(job && job.span[0] < lead.end)) {
    name = lead.name;
    if (lead.cut) cuts.push([0, lead.end]);
  } else if (linkedinUrl) {
    name = nameFromSlug(linkedinUrl);
  }

  // Overlaps merged, then cut from the end, so the earlier ranges keep their places.
  const merged: [number, number][] = [];
  for (const [s, e] of cuts.sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  let rest = text;
  for (const [s, e] of merged.reverse()) rest = `${rest.slice(0, s)} ${rest.slice(e)}`;

  return {
    name,
    email: email ? email[1]! : null,
    linkedinUrl,
    jobId: job?.jobId ?? null,
    referredBy: ref?.name ?? null,
    note: tidy(rest),
  };
}
