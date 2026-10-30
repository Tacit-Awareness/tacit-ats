import { brandTheme, isBrandAccent } from "@tacit/core/dist/brand/theme.js";
import { createUserClient, type Db } from "@tacit/db";
import type { BoardRole } from "./board";
import type { Channel } from "./channel";

/**
 * The public job pages (/careers/[org], /jobs/[slug] and
 * /api/jobs/[slug]/apply): a client's live posts, read and applied to by anyone
 * with the link. No session of any kind, and only the publishable key with no
 * token, so every call goes out as `anon`, which may run exactly five
 * functions here (packages/db, 20261016150000_client_job_posts,
 * 20261030130000_job_board_public, 20261030180000_job_post_views_channels and
 * 20261030233000_org_brand):
 * job_board_public, an org's live posts, job_post_page, one post's public
 * fields, submit_job_application, the one way in, and record_job_post_view, a
 * count of one more view, and org_brand_public, an org's accent and logo. None returns anything about who is on file.
 * src/client-area.test.ts fails if anything reachable from the public pages
 * can get another database client or a session.
 */

export const SLUG = /^[a-z0-9]{24,64}$/;
/** An org's slug, as `slugifyOrgName` makes them. */
export const ORG_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
/** The form's hidden field; a person never fills it, and the database answers a filled one with a quiet success. */
export const HONEYPOT_FIELD = "website";
/** Each answer's field is a_<question id>, so no question can collide with the honeypot. */
export const ANSWER_PREFIX = "a_";
export const FORM_MAX_BYTES = 200_000;

/**
 * Voluntary self-identification (US EEO-1, VEVRAA, Section 503), apart from
 * the post's questions: fields eeoc_<question>, each defaulting to "decline
 * to self-identify" on the page. submit_job_application writes them on the
 * new application with source 'candidate' (packages/db,
 * 20261016170000_client_reports_eeoc); no one at the company reads one
 * person's answers, only an admin's totals.
 */
export const EEOC_PREFIX = "eeoc_";
export const DECLINE = "decline_to_self_identify";
export const EEOC_QUESTIONS: ReadonlyArray<{ key: string; label: string; options: ReadonlyArray<readonly [string, string]> }> = [
  {
    key: "gender",
    label: "Gender",
    options: [["female", "Female"], ["male", "Male"], [DECLINE, "I decline to self-identify"]],
  },
  {
    key: "race_ethnicity",
    label: "Race / ethnicity",
    options: [
      ["hispanic_or_latino", "Hispanic or Latino"],
      ["white", "White (not Hispanic or Latino)"],
      ["black_or_african_american", "Black or African American (not Hispanic or Latino)"],
      ["native_hawaiian_or_other_pacific_islander", "Native Hawaiian or Other Pacific Islander (not Hispanic or Latino)"],
      ["asian", "Asian (not Hispanic or Latino)"],
      ["american_indian_or_alaska_native", "American Indian or Alaska Native (not Hispanic or Latino)"],
      ["two_or_more_races", "Two or more races (not Hispanic or Latino)"],
      [DECLINE, "I decline to self-identify"],
    ],
  },
  {
    key: "veteran_status",
    label: "Veteran status",
    options: [
      ["protected_veteran", "I identify as one or more of the classifications of protected veteran"],
      ["not_a_protected_veteran", "I am not a protected veteran"],
      [DECLINE, "I decline to self-identify"],
    ],
  },
  {
    key: "disability_status",
    label: "Disability status",
    options: [
      ["has_disability", "Yes, I have a disability (or previously had one)"],
      ["no_disability", "No, I do not have a disability"],
      [DECLINE, "I decline to self-identify"],
    ],
  },
];

export type PublicQuestion = {
  id: string;
  type: "name" | "email" | "phone" | "linkedin" | "resume" | "short_text" | "long_text" | "yes_no" | "select";
  label: string;
  required: boolean;
  options?: string[];
};

export type PublicJobPost = {
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  questions: PublicQuestion[];
  /** The org's board, null when it has none (Tacit's own). */
  orgSlug: string | null;
  department: string | null;
};

export type PublicJobBoard = { company: string; roles: BoardRole[] };

/** The anon client: the publishable key and never a token. Not memoized; nothing in it is per-user anyway. */
/** `colors`: the company's accent as the page's primary colour, its light token, since these pages have no dark theme. */
export type PublicBrand = { colors: { solid: string; onSolid: string } | null; logoUrl: string | null };

function anonDb(): Db {
  return createUserClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "", () => null);
}

/** A live post on an open job, or null for anything else (wrong, draft, closed, job not open). */
export async function readJobPost(slug: string): Promise<PublicJobPost | null> {
  if (!SLUG.test(slug)) return null;
  const { data, error } = await anonDb().rpc("job_post_page", { p_slug: slug });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return null;
  return {
    title: row.title,
    company: row.company,
    location: row.location,
    description: row.description,
    questions: Array.isArray(row.questions) ? (row.questions as unknown as PublicQuestion[]) : [],
    orgSlug: row.org_slug,
    department: row.department,
  };
}

/** A client's board, or null for an org that is not one or has no live post: the same answer, so a stranger learns nothing. */
export async function readJobBoard(org: string): Promise<PublicJobBoard | null> {
  if (!ORG_SLUG.test(org)) return null;
  const { data, error } = await anonDb().rpc("job_board_public", { p_org: org });
  if (error) throw new Error(error.message);
  const first = data?.[0];
  if (!first) return null;
  return {
    company: first.company,
    roles: data.map((r) => ({ slug: r.slug, title: r.title, location: r.location, department: r.department })),
  };
}

/**
 * A client's accent and logo, or null for one with none. Only looks: a failed
 * read leaves the page in Tacit's own colours rather than taking it down.
 */
export async function readOrgBrand(org: string | null): Promise<PublicBrand | null> {
  if (!org || !ORG_SLUG.test(org)) return null;
  const { data, error } = await anonDb().rpc("org_brand_public", { p_org: org });
  if (error) {
    console.error("[careers] brand:", error.message);
    return null;
  }
  const row = data?.[0];
  if (!row) return null;
  const light = isBrandAccent(row.accent) ? brandTheme(row.accent).light : null;
  return { colors: light && { solid: light.accent, onSolid: light["accent-ink"] }, logoUrl: row.logo_url };
}

export type ApplyOutcome =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "busy" }
  | { status: "invalid"; reason: "required" | "too_long" | "invalid"; questionId: string | null }
  | { status: "failed" };

const QUESTION_ERROR = /^(q_[a-z0-9]{4,32}|name|email|phone|linkedin|resume): (required|too_long|invalid)$/;

/** Maps the database's answer onto what the page says. The message names a question id at most. */
export function applyOutcome(error: { code?: string; message?: string } | null): ApplyOutcome {
  if (!error) return { status: "ok" };
  if (error.code === "P0002") return { status: "not_found" };
  if (error.code === "PT429") return { status: "busy" };
  if (error.code === "22023") {
    const m = QUESTION_ERROR.exec(error.message ?? "");
    return m
      ? { status: "invalid", reason: m[2] as "required" | "too_long" | "invalid", questionId: m[1] }
      : { status: "invalid", reason: "invalid", questionId: null };
  }
  return { status: "failed" };
}

/**
 * The answers object submit_job_application takes, from the posted form: only
 * a_<id> fields, as text; the honeypot; and the EEO answers apart (only the
 * four eeoc_ fields, as text; the database checks the values).
 */
export function answersFromForm(form: FormData): {
  answers: Record<string, string>;
  honeypot: string;
  eeoc: Record<string, string>;
} {
  const answers: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string" || !key.startsWith(ANSWER_PREFIX)) continue;
    answers[key.slice(ANSWER_PREFIX.length)] = value;
  }
  const eeoc: Record<string, string> = {};
  for (const q of EEOC_QUESTIONS) {
    const value = form.get(`${EEOC_PREFIX}${q.key}`);
    if (typeof value === "string" && value !== "") eeoc[q.key] = value;
  }
  const honeypot = form.get(HONEYPOT_FIELD);
  return { answers, honeypot: typeof honeypot === "string" ? honeypot : "", eeoc };
}

export async function submitApplication(
  slug: string,
  answers: Record<string, string>,
  honeypot: string,
  eeoc: Record<string, string> = {},
  channel: Channel | null = null,
): Promise<ApplyOutcome> {
  if (!SLUG.test(slug)) return { status: "not_found" };
  // The channel is the function's five-argument form, which takes every argument. Null is not recorded.
  const { error } = await anonDb().rpc(
    "submit_job_application",
    channel
      ? { p_slug: slug, p_answers: answers, p_honeypot: honeypot, p_eeoc: eeoc, p_channel: channel }
      : { p_slug: slug, p_answers: answers, p_honeypot: honeypot, ...(Object.keys(eeoc).length ? { p_eeoc: eeoc } : {}) },
  );
  const outcome = applyOutcome(error);
  if (outcome.status === "failed") console.error("[jobs] an application failed:", error?.code, error?.message);
  return outcome;
}

/**
 * One more view of a post, or nothing for a post that is not live: the
 * function answers alike and holds its own per-post limits. A count is never
 * worth a failure a reader can see, so this never throws.
 */
export async function recordJobPostView(slug: string): Promise<void> {
  if (!SLUG.test(slug)) return;
  try {
    const { error } = await anonDb().rpc("record_job_post_view", { p_slug: slug });
    if (error) console.error("[jobs] a view was not counted:", error.code, error.message);
  } catch (e) {
    console.error("[jobs] a view was not counted:", e instanceof Error ? e.message : "unknown");
  }
}
