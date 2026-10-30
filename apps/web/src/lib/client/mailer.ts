import "server-only";

import { connector } from "@tacit/core";
import type { clientTools } from "@tacit-ats/core";

type Env = Record<string, string | undefined>;

/**
 * How apps/web delivers a member's email to a candidate: the same ClientMailer
 * as apps/mcp's clientMailer, through the same Resend sender, From a
 * Tacit-controlled address under the member's name, with Reply-To their own.
 * One difference: there is no default From here. The web app is off until both
 * RESEND_API_KEY and CLIENT_EMAIL_FROM are set, and CLIENT_EMAIL_DISABLED turns
 * it off whatever else is, so a deployment with neither can write nothing and
 * send nothing. Null = off, and the pages say so instead of offering a Send.
 */
export function webMailer(env: Env = process.env): clientTools.ClientMailer | null {
  if (env.CLIENT_EMAIL_DISABLED?.trim()) return null;
  const apiKey = env.RESEND_API_KEY?.trim();
  const fromAddress = env.CLIENT_EMAIL_FROM?.trim();
  if (!apiKey || !fromAddress) return null;
  if (!connector.isPlainEmail(fromAddress)) {
    console.error("[client-email] CLIENT_EMAIL_FROM is not an email address; candidate email is off");
    return null;
  }
  return { send: connector.makeResendSender({ apiKey }), fromAddress };
}
