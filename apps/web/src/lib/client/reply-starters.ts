// What the reply box opens with (design/tats's draftFor): a few words a member
// reads and changes before anything is written. Pure. The text is real, not
// {{placeholders}}, so the box already reads like the email, and core still
// fills or refuses anything a member types. The one exception is the
// Testbench starter's link: each candidate gets their own, made only when a
// draft is asked for (applicants/actions.ts's draftReplyAction), so the
// starter holds a marker where it goes. The marker is a placeholder core does
// not fill, so one that is somehow not replaced is refused by core's
// draftEmail, never emailed.

/** Where the candidate's own Testbench invite link goes in a reply. */
export const TESTBENCH_LINK = "{{testbench_link}}";
/** As core reads a placeholder: spaces inside the braces allowed. */
const TESTBENCH_LINK_PATTERN = /\{\{\s*testbench_link\s*\}\}/g;
export const hasTestbenchLink = (text: string): boolean => text.search(TESTBENCH_LINK_PATTERN) !== -1;
/** A function, so nothing in the link is read as a replacement pattern. */
export const withTestbenchLink = (text: string, url: string): string => text.replace(TESTBENCH_LINK_PATTERN, () => url);

export const REPLY_KINDS = ["interview", "testbench", "decline", "blank"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];
export type ReplyStarters = { subject: string; bodies: Record<ReplyKind, string> };

/** Braces in a name or a title could read to core as a placeholder it can't fill: every one goes, so none can close up. */
const plain = (s: string) => s.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
const firstName = (name: string | null) => plain(name ?? "").split(" ")[0] ?? "";

/** session.ts falls back to the email address for someone with no name: that is no sign-off. */
const signature = (name: string) => (name.includes("@") ? "" : firstName(name));

export function replyStarters(v: { candidateName: string | null; jobTitle: string | null; company: string; sender: string }): ReplyStarters {
  const first = firstName(v.candidateName);
  const hi = first ? `Hi ${first},` : "Hi,";
  const job = plain(v.jobTitle ?? "");
  const role = job ? `the ${job} role` : "the role";
  const sign = signature(v.sender);
  const letter = (text: string) => [hi, text, sign].filter(Boolean).join("\n\n");
  return {
    subject: job ? `Your application for ${job}` : "Your application",
    bodies: {
      interview: letter(`Thanks for applying for ${role}. The team would like to meet you. What times work for you this week or next? Please reply with a few options, and your time zone.`),
      testbench: letter(`Thanks for applying for ${role}. Before we talk, we'd like you to try a short take-home in a real coding environment. Do it whenever suits you this week. The link is below.\n\n${TESTBENCH_LINK}`),
      decline: letter(`Thank you for applying for ${role}, and for your interest in ${plain(v.company)}. We've looked closely and decided not to move forward right now. We'd be glad to hear from you again in the future.`),
      blank: letter(""),
    },
  };
}
