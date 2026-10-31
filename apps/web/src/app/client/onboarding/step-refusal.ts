import { clientTools } from "@tacit-ats/core";

// What the Teams and Interview skills actions answer. A tick saves at once and the
// page stays put, so the sentence travels back to a toast and never rides in a URL.
// Tool sentences name no one. Not a "use server" file: only those actions import
// its value; a client component takes the types.

export type Refused = { ok: false; error: string };
export type StepAnswer = { ok: true; changed: boolean } | Refused;

export const GONE = "That's no longer there. Reload to see it as it stands.";

const SENTENCES: Partial<Record<clientTools.ClientToolErrorCode, string>> = {
  forbidden: "Only an admin can change this.",
  not_found: GONE,
  rate_limited: "You've made 300 changes in the last hour, the limit. Nothing was saved. Try again later.",
};

// A sentence written for the connector names its tools.
const forPeople = (message: string) => message.replace(/ Pick another from list_departments\.$/, " Reload to see your teams.");

export function stepRefusal(err: unknown, what: string): Refused {
  if (err instanceof clientTools.ClientToolError) {
    const sentence = err.code === "invalid" ? forPeople(err.message) : SENTENCES[err.code];
    if (sentence) return { ok: false, error: sentence };
  }
  console.error(`[client-onboarding] ${what} failed:`, err instanceof Error ? err.message : err);
  // A write can fail after it landed, so this cannot promise that nothing changed.
  return { ok: false, error: "That didn't save, and it may not have gone through. Reload and check." };
}
