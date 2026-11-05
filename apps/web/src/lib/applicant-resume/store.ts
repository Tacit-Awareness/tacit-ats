import { getSupabaseServiceClient } from "@tacit/db";

/**
 * The bytes of a resume uploaded on a public job post (/jobs/[slug]): the one
 * privileged write the public pages reach, and only from the apply route
 * (src/client-area.test.ts's "the one way to an applicant's resume").
 *
 * The private `org-files` bucket has no policies for anon, so the bytes need
 * the service role. What keeps that narrow: the path is never input. It is
 * what submit_job_application answered on the publishable key, after the
 * database had checked the post, the answers and the hourly limits and
 * inserted the person_files row at that path (tacit-internal's packages/db,
 * 20261108120000_job_post_resume_upload). Anything else is refused before
 * Storage is asked. If the upload fails, the row the function just added for
 * it is deleted, by that same path, so no candidate's file points at nothing.
 *
 * One function, never the client. No upsert: a path is a new row's own, so an
 * object already there is a failure, not something to replace.
 */
const BUCKET = "org-files";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ROW_PATH = new RegExp(`^${UUID}/${UUID}/${UUID}$`);

export async function storeApplicantResume(storagePath: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
  if (!ROW_PATH.test(storagePath)) return false;
  const db = getSupabaseServiceClient();
  const { error } = await db.storage.from(BUCKET).upload(storagePath, bytes, { contentType, upsert: false });
  if (!error) return true;
  console.error("[jobs] an applicant's resume was not stored:", error.message);
  const removed = await db.from("person_files").delete().eq("storage_path", storagePath).eq("kind", "resume").is("uploaded_by_actor_id", null);
  if (removed.error) console.error("[jobs] and its row was not removed:", removed.error.code, removed.error.message);
  return false;
}
