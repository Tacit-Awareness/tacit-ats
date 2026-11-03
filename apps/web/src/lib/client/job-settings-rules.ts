// A job's own settings from the posting editor: its title, its status and its
// openings (Greenhouse's headcount). The posted forms read back, pure and
// type-only, since the panel is a client component. Core's `updateJob`,
// `addOpenings` and `closeOpening` check everything again and decide who may
// (whoever may manage the job); this refuses what a form should never send, so
// a refusal keeps what was typed. The limits are core's (TITLE_MAX,
// OPENINGS_ADD_MAX, CLOSE_REASON_MAX), repeated here and held together by
// job-settings-rules.test.ts.

export const JOB_TITLE_MAX = 200;
export const OPENINGS_ADD_MAX = 50;
export const CLOSE_REASON_MAX = 200;

/** What a member may move a job to. Filled is the database's: the last opening filled by a hire. */
export const SETTABLE_STATUSES = ["open", "paused", "closed"] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

export const JOB_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  paused: "Paused",
  closed: "Closed",
  filled: "Filled",
  pending_approval: "Pending approval",
};

export type JobSettingsError =
  | "title_required"
  | "title_too_long"
  | "bad_status"
  | "needs_approval"
  | "status_changed"
  | "bad_count"
  | "reason_required"
  | "reason_too_long"
  | "opening_filled"
  | "not_found"
  | "forbidden"
  | "rate_limited"
  | "failed";

export const JOB_SETTINGS_ERRORS: Record<JobSettingsError, string> = {
  title_required: "A job needs a title.",
  title_too_long: `A title is at most ${JOB_TITLE_MAX} characters.`,
  bad_status: "Pick Open, Paused or Closed.",
  needs_approval: "Opening this job needs an approval first, so nothing was changed. Ask for one with the connector's request_approval.",
  status_changed: "Someone changed this job's status while you had it open, so nothing was saved. The page now shows its status: pick again if you still want to change it.",
  bad_count: `Add between 1 and ${OPENINGS_ADD_MAX} openings at a time.`,
  reason_required: "Say why you're closing it.",
  reason_too_long: `A reason is at most ${CLOSE_REASON_MAX} characters.`,
  opening_filled: "That opening is filled. Moving its hire out of Hired opens it again; then it can be closed.",
  not_found: "That job or opening isn't there, or you can't see it.",
  forbidden: "You can't change this job. Ask whoever manages it, or an admin.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Try again later.",
  failed: "That didn't work. What you typed is still here: try again.",
};

export type JobSettingsNotice = "saved" | "unchanged" | "added" | "closed";

export const JOB_SETTINGS_NOTICES: Record<JobSettingsNotice, string> = {
  saved: "Saved.",
  unchanged: "Nothing to change.",
  added: "Added.",
  closed: "Closed it.",
};

/** The job form: its title and status as typed. */
export type JobDraft = { title: string; status: string };
/** The openings forms: how many to add, and the reason given for closing one. */
export type OpeningsDraft = { count: string; reason: string; openingId: string | null };

export type JobFormState = { notice?: JobSettingsNotice; error?: JobSettingsError; draft?: JobDraft };
export type OpeningsFormState = { notice?: JobSettingsNotice; error?: JobSettingsError; draft?: OpeningsDraft };

/** What the panel opens on. `openings` is null when they cannot be read (the panel then leaves them out). */
export type JobSettings = {
  jobId: string;
  title: string;
  status: string;
  openings: {
    counts: { open: number; filled: number; closed: number };
    /** The open ones, which are the ones that can be closed. */
    open: { openingId: string; number: number; code: string | null }[];
  } | null;
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres text cannot hold a NUL or half a surrogate pair, and a title or a reason is one line (posting-edit-rules' cleanLine, untrimmed). */
const line = (v: FormDataEntryValue | null) =>
  // eslint-disable-next-line no-control-regex
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\p{Cs}]/gu, " ") : "";
const tidy = (v: string) => v.trim().replace(/\s+/g, " ");

export const isSettableStatus = (v: unknown): v is SettableStatus => typeof v === "string" && (SETTABLE_STATUSES as readonly string[]).includes(v);

/**
 * The job form: `jobId`, `title`, `status`. Only what differs from what the
 * page opened on (`was:title`, `was:status`) is sent, so a save never puts
 * back a title or status someone else changed meanwhile unless this member
 * changed it too. A status change carries `expectedStatus`, the `was:status`
 * it was picked against, so core refuses it if the job has moved on since
 * rather than put an old view's status back; a title alone never touches the
 * status. A status the page drew but a member cannot pick (filled, pending
 * approval) is left as it is.
 */
export function parseJobForm(form: FormData):
  | { ok: true; jobId: string; change: { title?: string; status?: SettableStatus; expectedStatus?: string }; draft: JobDraft }
  | { ok: false; error: JobSettingsError; draft: JobDraft }
  | { ok: false; error: null } {
  const jobId = line(form.get("jobId"));
  if (!UUID.test(jobId)) return { ok: false, error: null };
  const title = line(form.get("title"));
  const status = line(form.get("status"));
  const draft: JobDraft = { title, status };

  const change: { title?: string; status?: SettableStatus; expectedStatus?: string } = {};
  const next = tidy(title);
  if (!next) return { ok: false, error: "title_required", draft };
  if (next.length > JOB_TITLE_MAX) return { ok: false, error: "title_too_long", draft };
  if (next !== tidy(line(form.get("was:title")))) change.title = next;
  const was = line(form.get("was:status"));
  if (status !== was) {
    if (!isSettableStatus(status)) return { ok: false, error: "bad_status", draft };
    change.status = status;
    change.expectedStatus = was;
  }
  return { ok: true, jobId, change, draft };
}

/** "Add openings": `jobId` and `count`, a whole number from 1 to OPENINGS_ADD_MAX. */
export function parseAddOpenings(form: FormData):
  | { ok: true; jobId: string; count: number }
  | { ok: false; error: JobSettingsError; draft: OpeningsDraft }
  | { ok: false; error: null } {
  const jobId = line(form.get("jobId"));
  if (!UUID.test(jobId)) return { ok: false, error: null };
  const raw = tidy(line(form.get("count")));
  const count = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!(count >= 1 && count <= OPENINGS_ADD_MAX)) return { ok: false, error: "bad_count", draft: { count: raw, reason: "", openingId: null } };
  return { ok: true, jobId, count };
}

/** Closing one opening: `openingId` and a `reason`, which core keeps on the row and out of the audit row. */
export function parseCloseOpening(form: FormData):
  | { ok: true; openingId: string; reason: string }
  | { ok: false; error: JobSettingsError; draft: OpeningsDraft }
  | { ok: false; error: null } {
  const openingId = line(form.get("openingId"));
  if (!UUID.test(openingId)) return { ok: false, error: null };
  const typed = line(form.get("reason"));
  const reason = tidy(typed);
  const draft: OpeningsDraft = { count: "", reason: typed, openingId };
  if (!reason) return { ok: false, error: "reason_required", draft };
  if (reason.length > CLOSE_REASON_MAX) return { ok: false, error: "reason_too_long", draft };
  return { ok: true, openingId, reason };
}

/** Core's refusals as the panel's codes. `invalid` is told apart by its sentence, which job-settings.test.ts pins. */
export function jobSettingsRefusal(code: string, message: string): JobSettingsError {
  if (code === "forbidden") return "forbidden";
  if (code === "not_found") return "not_found";
  if (code === "rate_limited") return "rate_limited";
  if (code !== "invalid") return "failed";
  if (/approval/i.test(message)) return "needs_approval";
  if (/status changed since it was read/i.test(message)) return "status_changed";
  if (/is filled/i.test(message)) return "opening_filled";
  if (/needs a reason/i.test(message)) return "reason_required";
  if (/close reason/i.test(message)) return "reason_too_long";
  if (/openings at a time/i.test(message)) return "bad_count";
  if (/needs a title/i.test(message)) return "title_required";
  if (/title is at most/i.test(message)) return "title_too_long";
  if (/status is one of/i.test(message)) return "bad_status";
  return "failed";
}
