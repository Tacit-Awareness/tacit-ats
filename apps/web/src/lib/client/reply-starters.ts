// What the reply box opens with (design/tats's draftFor): a few words a member
// reads and changes before anything is written. Pure. The text is real, not
// {{placeholders}}, so the box already reads like the email, and core still
// fills or refuses anything a member types. design/tats's Testbench starter is
// left out: it needs a link nothing here can make.

export const REPLY_KINDS = ["interview", "decline", "blank"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];
export type ReplyStarters = { subject: string; bodies: Record<ReplyKind, string> };

/** Double braces in a name or a title would read to core as a placeholder it can't fill. */
const plain = (s: string) => s.replace(/\{\{|\}\}/g, "").replace(/\s+/g, " ").trim();
const firstName = (name: string | null) => plain(name ?? "").split(" ")[0] ?? "";

export function replyStarters(v: { candidateName: string | null; jobTitle: string | null; company: string; sender: string }): ReplyStarters {
  const first = firstName(v.candidateName);
  const hi = first ? `Hi ${first},` : "Hi,";
  const job = plain(v.jobTitle ?? "");
  const role = job ? `the ${job} role` : "the role";
  const sign = firstName(v.sender);
  const letter = (text: string) => [hi, text, sign].filter(Boolean).join("\n\n");
  return {
    subject: job ? `Your application for ${job}` : "Your application",
    bodies: {
      interview: letter(`Thanks for applying for ${role}. The team would like to meet you. Someone from the team will email you a few times this week.`),
      decline: letter(`Thank you for applying for ${role}, and for your interest in ${plain(v.company)}. We've looked closely and decided not to move forward right now. We'd be glad to hear from you again in the future.`),
      blank: letter(""),
    },
  };
}
