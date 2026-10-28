import { verifyAgentDestination, type VerifyResult } from "@tacit/core";
import { getSupabaseServiceClient, type Db } from "@tacit/db";

/**
 * Checking that the company's bot answers at its address: the second
 * client-area module allowed a privileged client (src/client-area.test.ts),
 * after bind.ts. The challenge is signed with the bot's secret, which no
 * member's token can read, so the send needs the service role.
 *
 * The caller's own token decides first: only an admin can read the company's
 * bot row (agent_destinations' policy), so a member who is not one finds none
 * and nothing is sent. The org is the signed-in member's, never from input.
 * Exports this function and never the client.
 */
export async function verifyCompanyBot(member: { db: Db; orgId: string }): Promise<VerifyResult> {
  const { data, error } = await member.db.from("agent_destinations").select("id").eq("org_id", member.orgId).maybeSingle();
  if (error) throw new Error(`agent_destinations: ${error.message}`);
  if (!data) return { ok: false, reason: "no_destination" };
  return verifyAgentDestination(getSupabaseServiceClient(), member.orgId);
}
