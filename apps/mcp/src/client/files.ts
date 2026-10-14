import { getSupabaseServiceClient } from "@tacit/db";

/**
 * Storage for candidates' files: the private `org-files` bucket, which has no
 * policies for a member's token, so signing a link and uploading need the
 * service role. The third module under src/client allowed a privileged client
 * (src/client-connector.test.ts), and like the other two it exports only its
 * functions, never the client.
 *
 * The rule that keeps this narrow is the caller's: core's clientTools files.ts
 * calls these only after the member's own client has read the person_files
 * row (a link) or inserted it (an upload), so RLS has already decided, and the
 * path is always that row's own <org_id>/<person_id>/<id>, never input.
 */
const BUCKET = "org-files";

const bucket = () => getSupabaseServiceClient().storage.from(BUCKET);

/** A link that works for `seconds` and downloads as `filename`; null when nothing is stored at the path. */
export async function signFileUrl(storagePath: string, seconds: number, filename: string): Promise<string | null> {
  const { data, error } = await bucket().createSignedUrl(storagePath, seconds, { download: filename });
  if (error) {
    if (/not.?found/i.test(error.message)) return null;
    throw new Error(`org-files: sign ${storagePath}: ${error.message}`);
  }
  return data.signedUrl;
}

/** Stores a new object. Never overwrites: every path is a new row's. */
export async function putFile(storagePath: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await bucket().upload(storagePath, bytes, { contentType, upsert: false });
  if (error) {
    const hint = /bucket not found/i.test(error.message) ? " (create the private org-files bucket: apps/mcp/CLAUDE.md)" : "";
    throw new Error(`org-files: upload ${storagePath}: ${error.message}${hint}`);
  }
}
