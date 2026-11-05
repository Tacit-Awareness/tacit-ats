import { clientTools } from "@tacit-ats/core";

// A resume picked in a form, checked the way core's addFile checks a file:
// the type from the extension, at most FILE_MAX_BYTES, the bytes starting like
// that type, and a name core takes. Shared by the referral form (lib/client)
// and the public application (lib/public), neither of which it reaches into:
// no client and no session here.

/** What a file input takes: every extension core's FILE_TYPES lists. */
export const RESUME_ACCEPT = Object.values(clientTools.FILE_TYPES).flatMap((t) => t.extensions.map((e) => `.${e}`)).join(",");

/** The types in words, for a hint under the picker. */
export const RESUME_TYPES_WORDS = "PDF, Word, text, PNG or JPEG";

/** A name core's addFile takes: anything else in it becomes a space, and the extension stays. */
export function resumeName(raw: string, ext: string): string {
  const stem = raw.slice(0, raw.lastIndexOf(".")).replace(/[^\p{L}\p{N} ._()&,+'-]/gu, " ").replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim().slice(0, 150);
  return `${stem || "Resume"}.${ext}`;
}

export type CheckedResume = { filename: string; contentType: string; bytes: Uint8Array };

/**
 * The form's file: null when none was picked, "too_big" past the cap,
 * "invalid" for anything else core would refuse. An empty file input can reach
 * the server with a name ("blob", "undefined", by browser and runtime), so any
 * zero-byte upload counts as none picked.
 */
export async function checkResume(value: FormDataEntryValue | null): Promise<CheckedResume | null | "too_big" | "invalid"> {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > clientTools.FILE_MAX_BYTES) return "too_big";
  const ext = value.name.includes(".") ? value.name.slice(value.name.lastIndexOf(".") + 1).toLowerCase() : "";
  const found = Object.entries(clientTools.FILE_TYPES).find(([, t]) => t.extensions.includes(ext));
  if (!found) return "invalid";
  const [contentType, type] = found;
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (!type.looksRight(bytes)) return "invalid";
  return { filename: resumeName(value.name, ext), contentType, bytes };
}
