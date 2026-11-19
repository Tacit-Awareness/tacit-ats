import { headers } from "next/headers";

// Triage (app/client/triage) draws New Applicants' ticket and the Inbox's issue
// card with their own forms, so their actions post as they always have. After a
// write they go back to the page they came from: Triage when the request came
// from it, by the browser's Referer, else the page they always went to. Only a
// choice between known pages, never a path from the request.

export const TRIAGE_PATH = "/client/triage";

/** Whether this server action was posted from Triage. */
export async function postedFromTriage(): Promise<boolean> {
  try {
    const referer = (await headers()).get("referer");
    return !!referer && new URL(referer).pathname === TRIAGE_PATH;
  } catch {
    // No request to read (a test calling the action by hand), or a Referer that isn't a URL: the page it always went to.
    return false;
  }
}
