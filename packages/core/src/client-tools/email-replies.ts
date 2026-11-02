// A candidate's reply to a member's email. Each email goes out with a Reply-To
// naming its own candidate_emails row, so what comes back says which email it
// answers without guessing from a subject or an address. Pure: the receiving is
// apps/web's webhook, which reads the mail and writes candidate_email_replies
// with the service role. The words are the candidate's, so they stay plain
// text, and out of every audit row.

export const REPLY_BODY_MAX = 20_000;
const REPLY_SUBJECT_MAX = 300;

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const TAGGED = /(?:^|[\s<,"'])reply\+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/;

/** The receiving domain as configured, or null when replies aren't received here. */
export function parseReplyDomain(value: string | undefined): string | null {
  const domain = value?.trim().toLowerCase();
  return domain && DOMAIN.test(domain) ? domain : null;
}

export const replyAddress = (emailId: string, domain: string) => `reply+${emailId}@${domain}`;

/** The candidate_emails id an arriving email was addressed to, or null when it is not a reply. */
export function repliedEmailId(addresses: string[]): string | null {
  for (const a of addresses) {
    const id = TAGGED.exec(a.toLowerCase())?.[1];
    if (id) return id;
  }
  return null;
}

/** `Ada <ada@x.test>` or `ada@x.test` as the bare address, lower case. */
export function addressOf(from: string): string {
  return (/<([^<>\s]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
}

// What Postgres text or a JSON body refuses: NUL, and half a surrogate pair.
const storable = (s: string) => s.replace(/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** An email with no text part, as text: a person reads it, nothing renders it. */
function htmlAsText(html: string): string {
  return html
    .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\b[^>]*>|<\/(p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\n{3,}/g, "\n\n");
}

/** What is kept of an arriving email: one line of subject, the body as text, both cut to what the table holds. */
export function readableReply(mail: { subject?: string | null; text?: string | null; html?: string | null }): { subject: string; body: string } {
  const body = mail.text?.trim() ? mail.text : htmlAsText(mail.html ?? "");
  return {
    subject: storable((mail.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, REPLY_SUBJECT_MAX)),
    body: storable(body.replace(/\r\n/g, "\n").trim().slice(0, REPLY_BODY_MAX)),
  };
}
