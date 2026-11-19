import { headers } from "next/headers";

// Triage (app/client/triage) draws New Applicants' ticket and the Inbox's issue
// card, and the Offer page the Inbox's approval decision, with their own forms, so their actions post as they always have. After a
// write they go back to the page they came from: Triage when the request came
// from it, by the browser's Referer, else the page they always went to. Only a
// choice between known pages, never a path from the request.

export const TRIAGE_PATH = "/client/triage";
/** The Offer page (app/client/tickets/offers) posts the Inbox's approval decision, and comes back the same way. */
export const OFFERS_PATH = "/client/tickets/offers";
const PAGES = [TRIAGE_PATH, OFFERS_PATH] as const;
export type ReturnPage = (typeof PAGES)[number];

/** Which of the pages that borrow these actions posted this one, by the Referer's path; null is the page it always went to. */
export async function postedFrom(): Promise<ReturnPage | null> {
  try {
    const referer = (await headers()).get("referer");
    if (!referer) return null;
    const path = new URL(referer).pathname;
    return PAGES.find((p) => p === path) ?? null;
  } catch {
    // No request to read (a test calling the action by hand), or a Referer that isn't a URL: the page it always went to.
    return null;
  }
}

/** Whether this server action was posted from Triage. */
export const postedFromTriage = async (): Promise<boolean> => (await postedFrom()) === TRIAGE_PATH;
