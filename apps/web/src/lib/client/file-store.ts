import { clientTools } from "@tacit-ats/core";
import { getSupabaseServiceClient } from "@tacit/db";

/**
 * Storage for candidates' files, the web side of apps/mcp's client/files.ts:
 * the fourth client-area module allowed a privileged client
 * (src/client-area.test.ts). The private `org-files` bucket has no policies for
 * a member's token, so uploading and signing a link need the service role.
 *
 * The rule that keeps this narrow is core's: clientTools' files.ts calls the
 * store only after the member's own client has inserted the person_files row
 * (an upload) or read it (a link), so RLS has already decided, and the path is
 * always that row's own, never input. What leaves this file is two functions,
 * never the client. No `remove`: an erasure isn't done from here.
 */
const BUCKET = "org-files";

const bucket = () => getSupabaseServiceClient().storage.from(BUCKET);

export function webFileStore(): clientTools.FileStore {
  return {
    put: async (storagePath, bytes, contentType) => {
      const { error } = await bucket().upload(storagePath, bytes, { contentType, upsert: false });
      if (error) throw new Error(`org-files: upload ${storagePath}: ${error.message}`);
    },
    signedUrl: async (storagePath, seconds, filename) => {
      const { data, error } = await bucket().createSignedUrl(storagePath, seconds, { download: filename });
      if (error) {
        if (/not.?found/i.test(error.message)) return null;
        throw new Error(`org-files: sign ${storagePath}: ${error.message}`);
      }
      return data.signedUrl;
    },
  };
}
