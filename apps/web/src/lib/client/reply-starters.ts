// What the reply box opens with (design/tats's draftFor): a few words a member
// reads and changes before anything is written. Pure. The text is real, not
// {{placeholders}}, so the box already reads like the email, and core still
// fills or refuses anything a member types.

// One invite for every company and candidate, for now: nothing here makes a
// link per candidate yet.
export const TESTBENCH_INVITE_URL = "https://testbench.tacitawareness.com/invite/GDB7muAgdC1ivZmnGPfBrAJHSyorDj-68qPh8FCc4Cc";

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
      interview: letter(`Thanks for applying for ${role}. The team would like to meet you. Someone from the team will email you a few times this week.`),
      testbench: letter(`Thanks for applying for ${role}. Before we talk, we'd like you to try a short take-home in a real coding environment. Do it whenever suits you this week. The link is below.\n\n${TESTBENCH_INVITE_URL}`),
      decline: letter(`Thank you for applying for ${role}, and for your interest in ${plain(v.company)}. We've looked closely and decided not to move forward right now. We'd be glad to hear from you again in the future.`),
      blank: letter(""),
    },
  };
}
