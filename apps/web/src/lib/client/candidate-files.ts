import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { pickedFileError, type FileError } from "./file-view-rules";

// A file added to a candidate from their page (candidates/[id]/file-upload.tsx):
// checked here first, so a refusal says which rule it broke, then core's
// audited addFile on the member's own client, whose can_edit_person check and
// the insert policy decide whether it lands. The store is the caller's
// (lib/client/file-store.ts), which core calls only once the row is in. The
// filename is the member's text: it goes into the row and nowhere else, never
// a log, an audit row or a URL.

export const FILE_KINDS = clientTools.FILE_KINDS;

/** Every extension core takes, as the file input's `accept` and the browser's own check. */
export const FILE_EXTENSIONS = Object.values(clientTools.FILE_TYPES).flatMap((t) => t.extensions);
export const FILE_ACCEPT = FILE_EXTENSIONS.map((e) => `.${e}`).join(",");

/** A file checked and ready for core's addFile. */
export type UploadFile = { filename: string; contentType: string; contentBase64: string };

/** A name core's addFile takes: anything else in it becomes a space, and the extension stays. */
export function uploadName(raw: string, ext: string, fallback: string): string {
  const dot = raw.lastIndexOf(".");
  const stem = (dot > 0 ? raw.slice(0, dot) : "")
    .replace(/[^\p{L}\p{N} ._()&,+'-]/gu, " ")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150)
    .trim();
  return `${stem || fallback}.${ext}`;
}

/** The form's file, by the type its extension names and bytes that are that type; or which rule it broke. */
export async function uploadFile(value: FormDataEntryValue | null, fallback: string): Promise<UploadFile | FileError> {
  if (!(value instanceof File) || (value.size === 0 && value.name === "")) return "file_missing";
  const picked = pickedFileError(value, FILE_EXTENSIONS, clientTools.FILE_MAX_BYTES);
  if (picked) return picked;
  const ext = value.name.slice(value.name.lastIndexOf(".") + 1).toLowerCase();
  const [contentType, type] = Object.entries(clientTools.FILE_TYPES).find(([, t]) => t.extensions.includes(ext))!;
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (bytes.length > clientTools.FILE_MAX_BYTES) return "file_big";
  if (!type.looksRight(bytes)) return "file_mismatch";
  return { filename: uploadName(value.name, ext, fallback), contentType, contentBase64: Buffer.from(bytes).toString("base64") };
}

export type AddFileOutcome = { ok: true; fileId: string } | { ok: false; error: FileError };

// The checks above leave core's `invalid` for a file Storage didn't take.
const REFUSALS: Record<clientTools.ClientToolErrorCode, FileError> = {
  forbidden: "file_forbidden",
  not_found: "file_gone",
  invalid: "failed",
  rate_limited: "rate_limited",
};

export async function addCandidateFile(
  db: Db,
  ctx: clientTools.ClientToolCtx,
  input: { candidateId: string; kind: clientTools.FileKind; file: UploadFile },
  store: clientTools.FileStore,
): Promise<AddFileOutcome> {
  try {
    const added = await clientTools.addFile(db, ctx, store, { candidateId: input.candidateId, kind: input.kind, ...input.file });
    return { ok: true, fileId: added.fileId };
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) return { ok: false, error: REFUSALS[err.code] };
    throw err;
  }
}
