// A member's Granola key, checked before /client/integrations stores it.
// Granola's public API has no OAuth: a member makes a key in the Granola app
// (Settings -> Connectors -> API keys, Business and Enterprise plans) and
// pastes it. The check lists one note with it, which both proves the key and
// says whose account it is (the note's owner). An account with no notes yet
// has no owner to read, so the email is then null.

const NOTES_URL = "https://public-api.granola.ai/v1/notes?page_size=1";

export type GranolaKeyError = "invalid" | "unreachable";

export type GranolaKeyCheck = { ok: true; accountEmail: string | null } | { ok: false; error: GranolaKeyError };

// What a pasted key may look like before it is sent anywhere: one token, no
// spaces, a sane length. Granola's keys start grn_, but that is theirs to
// change, so the shape is not checked further.
export function cleanGranolaKey(raw: string): string | null {
  const key = raw.trim();
  return key.length >= 8 && key.length <= 512 && /^[\x21-\x7e]+$/.test(key) ? key : null;
}

export async function checkGranolaKey(key: string, fetchImpl: typeof fetch = fetch): Promise<GranolaKeyCheck> {
  let res: Response;
  try {
    res = await fetchImpl(NOTES_URL, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
  } catch {
    return { ok: false, error: "unreachable" };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: "invalid" };
  if (!res.ok) return { ok: false, error: "unreachable" };
  const body = (await res.json().catch(() => null)) as { notes?: Array<{ owner?: { email?: unknown } }> } | null;
  const email = body?.notes?.[0]?.owner?.email;
  return { ok: true, accountEmail: typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : null };
}
