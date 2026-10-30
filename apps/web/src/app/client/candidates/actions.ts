"use server";

import { revalidatePath } from "next/cache";
import { bulkAddToPool, bulkReject, bulkTag } from "@/lib/client/crm-bulk";
import { parseBulkName, parseBulkReject, type BulkAnswer, type BulkNameInput } from "@/lib/client/crm-bulk-rules";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";

// The CRM's bulk actions: reject, tag, add to a pool. lib/client/crm-bulk.ts
// runs them on the signed-in member's own client, row by row, so the policies
// decide each one. The input is request data and is re-read
// (lib/client/crm-bulk-rules.ts); the answer is ids and codes, and the page
// words them with the names it already has.

async function run(write: () => Promise<BulkAnswer>): Promise<BulkAnswer> {
  let answer: BulkAnswer;
  try {
    answer = await write();
  } catch (err) {
    console.error("[client-crm] bulk run failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "failed" };
  }
  // A reject shows on the Pipeline, the job boards and Home too; a tag or a pool on the candidate page.
  if (answer.ok && answer.rows.some((r) => r.outcome === "done")) revalidatePath("/client", "layout");
  return answer;
}

export async function bulkRejectAction(raw: unknown): Promise<BulkAnswer> {
  const member = await requireClient();
  if (member.accessLevel === "limited") return { ok: false, error: "forbidden" };
  const input = parseBulkReject(raw);
  if (!input) return { ok: false, error: "invalid" };
  return run(() => bulkReject(member.db, toolCtx(member), input));
}

export async function bulkTagAction(raw: unknown): Promise<BulkAnswer> {
  const member = await requireClient();
  if (member.accessLevel === "limited") return { ok: false, error: "forbidden" };
  const input: BulkNameInput | null = parseBulkName(raw);
  if (!input) return { ok: false, error: "invalid" };
  return run(() => bulkTag(member.db, toolCtx(member), input));
}

export async function bulkAddToPoolAction(raw: unknown): Promise<BulkAnswer> {
  const member = await requireClient();
  if (member.accessLevel === "limited") return { ok: false, error: "forbidden" };
  const input: BulkNameInput | null = parseBulkName(raw);
  if (!input) return { ok: false, error: "invalid" };
  return run(() => bulkAddToPool(member.db, toolCtx(member), input));
}
