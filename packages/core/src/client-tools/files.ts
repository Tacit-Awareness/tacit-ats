import type { Db, TablesInsert } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, LIST_MAX, type ClientToolCtx } from "./context.js";

/**
 * A candidate's files (person_files, 20261015120000_client_person_files) for
 * the client connector. Same rules as the rest of client-tools: the member's
 * own client, and the policies decide which rows a member reads and whether
 * their insert lands. The bytes are in a private Storage bucket that members
 * have no policies on, so reaching them takes a privileged Storage client,
 * which this module never sees: the caller passes a FileStore, and this
 * module calls it only after the member's own client has read (a link) or
 * inserted (an upload) the row. The storage path is always the row's own,
 * <org_id>/<person_id>/<id>, which the insert policy checks.
 */

export const FILE_KINDS = ["resume", "attachment"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/**
 * Decoded. The bytes arrive base64 inside one JSON-RPC request, and the
 * deployment (Vercel) refuses a request body over 4.5 MB: 3 MB is 4 MB of
 * base64 with room for the rest of the call.
 */
export const FILE_MAX_BYTES = 3 * 1024 * 1024;
/** The longest content_base64 worth decoding: the cap, plus line breaks. */
export const FILE_BASE64_MAX = Math.floor(Math.ceil(FILE_MAX_BYTES / 3) * 4 * 1.05);
/** How long a link from getFileLink works. */
export const FILE_LINK_SECONDS = 300;
const FILENAME_MAX = 200;

const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((b, i) => bytes[i] === b);
const isUtf8Text = (bytes: Uint8Array) => {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

/** What may be attached: each type with its extensions and a check that the bytes are what the type says. */
export const FILE_TYPES: Record<string, { label: string; extensions: string[]; looksRight: (bytes: Uint8Array) => boolean }> = {
  "application/pdf": { label: "PDF", extensions: ["pdf"], looksRight: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
  "application/msword": {
    label: "Word (.doc)", extensions: ["doc"], looksRight: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    label: "Word (.docx)", extensions: ["docx"], looksRight: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  },
  "text/plain": { label: "plain text", extensions: ["txt"], looksRight: isUtf8Text },
  "image/png": { label: "PNG", extensions: ["png"], looksRight: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  "image/jpeg": { label: "JPEG", extensions: ["jpg", "jpeg"], looksRight: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
};
const TYPE_LIST = Object.values(FILE_TYPES).map((t) => t.label).join(", ");

/**
 * The privileged half, injected. Both are called only after the member's own
 * client has read or inserted the row the path came from.
 */
export type FileStore = {
  /** Stores the bytes at the path. Throws when they were not stored. */
  put: (storagePath: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  /** A link to the object that works for `seconds` and downloads as `filename`; null when there is no object there. */
  signedUrl: (storagePath: string, seconds: number, filename: string) => Promise<string | null>;
};

const unavailable = () =>
  new ClientToolError("forbidden", "Files are not available on this Tacit deployment yet. Nothing was read or saved.");
const candidateNotFound = () =>
  new ClientToolError("not_found", "No candidate with that id that you can see. Call search_candidates for the ids.");

export type CandidateFile = {
  fileId: string;
  kind: FileKind;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  /** The teammate who added it; null when Tacit did, or they have left. */
  uploadedBy: string | null;
  uploadedAt: string;
};

type FileRow = {
  id: string; kind: string; filename: string; content_type: string | null; size_bytes: number | null;
  uploaded_by_actor_id: string | null; created_at: string;
};

/** The candidate's files this member can read, newest first. Empty when none, or none they may see. */
export async function filesFor(db: Db, personId: string): Promise<CandidateFile[]> {
  const { data, error } = await db
    .from("person_files")
    .select("id, kind, filename, content_type, size_bytes, uploaded_by_actor_id, created_at")
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(LIST_MAX);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as FileRow[];
  const ids = [...new Set(rows.map((r) => r.uploaded_by_actor_id).filter((id): id is string => !!id))];
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { data: members, error: membersError } = await db.from("org_members").select("id, display_name").in("id", ids);
    if (membersError) throw new Error(membersError.message);
    for (const m of members ?? []) if (m.id) names.set(m.id, m.display_name);
  }
  return rows.map((r) => ({
    fileId: r.id,
    kind: r.kind as FileKind,
    filename: r.filename,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    uploadedBy: r.uploaded_by_actor_id ? (names.get(r.uploaded_by_actor_id) ?? null) : null,
    uploadedAt: r.created_at,
  }));
}

/** Whether the member can see the candidate at all: an interviewer through their card, anyone else through people. */
async function candidateVisible(db: Db, ctx: ClientToolCtx, personId: string): Promise<boolean> {
  if (ctx.accessLevel === "limited") {
    const { data, error } = await db.rpc("my_interview_candidates");
    if (error) throw new Error(error.message);
    return (data ?? []).some((c) => c.person_id === personId);
  }
  const { data, error } = await db.from("people").select("id").eq("id", personId).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

export async function listFiles(db: Db, ctx: ClientToolCtx, input: { candidateId: string }): Promise<CandidateFile[]> {
  const files = await filesFor(db, input.candidateId);
  // No rows is either no files or no candidate: say which.
  if (!files.length && !(await candidateVisible(db, ctx, input.candidateId))) throw candidateNotFound();
  return files;
}

export type FileLink = {
  fileId: string;
  candidateId: string;
  kind: FileKind;
  filename: string;
  url: string;
  expiresAt: string;
};

export async function getFileLink(
  db: Db,
  _ctx: ClientToolCtx,
  store: FileStore | null,
  input: { fileId: string },
  now: () => number = Date.now,
): Promise<FileLink> {
  if (!store) throw unavailable();
  // The member's own read is the permission check: a row they cannot see is not found.
  const { data, error } = await db
    .from("person_files")
    .select("id, org_id, person_id, kind, filename, storage_path")
    .eq("id", input.fileId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No file with that id that you can see. list_files lists a candidate's files.");
  if (data.storage_path !== `${data.org_id}/${data.person_id}/${data.id}`) {
    // Only the service role can write another path, and nothing does: refuse rather than sign it.
    throw new Error(`person_files ${data.id}: storage_path is not the row's own`);
  }
  const url = await store.signedUrl(data.storage_path, FILE_LINK_SECONDS, data.filename);
  if (!url) {
    throw new ClientToolError("not_found", "That file's contents are missing. Ask whoever added it to add it again.");
  }
  return {
    fileId: data.id,
    candidateId: data.person_id,
    kind: data.kind as FileKind,
    filename: data.filename,
    url,
    expiresAt: new Date(now() + FILE_LINK_SECONDS * 1000).toISOString(),
  };
}

/** A display name: letters, digits, spaces and a little punctuation, with the type's own extension. */
function checkFilename(raw: string, contentType: string): string {
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || name.length > FILENAME_MAX) throw new ClientToolError("invalid", `A filename is 1 to ${FILENAME_MAX} characters.`);
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._()&,+'-]*$/u.test(name)) {
    throw new ClientToolError(
      "invalid",
      "A filename may use letters, digits, spaces and . _ - ( ) & , + ' only, and starts with a letter or digit.",
    );
  }
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const type = FILE_TYPES[contentType];
  if (!type.extensions.includes(ext)) {
    throw new ClientToolError("invalid", `A ${type.label} file's name ends in .${type.extensions.join(" or .")}.`);
  }
  return name;
}

/** The decoded bytes, refusing anything that is not plain base64 or is over the cap, before decoding it. */
function decodeContent(raw: string): Uint8Array {
  const clean = raw.replace(/\s+/g, "");
  if (!clean) throw new ClientToolError("invalid", "The file is empty.");
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
    throw new ClientToolError("invalid", "content_base64 must be the file's bytes in standard base64, with nothing before them.");
  }
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  if ((clean.length / 4) * 3 - padding > FILE_MAX_BYTES) {
    throw new ClientToolError("invalid", `A file is at most ${FILE_MAX_BYTES / (1024 * 1024)} MB.`);
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!bytes.length) throw new ClientToolError("invalid", "The file is empty.");
  return bytes;
}

export async function addFile(
  db: Db,
  ctx: ClientToolCtx,
  store: FileStore | null,
  input: { candidateId: string; kind: FileKind; filename: string; contentBase64: string; contentType: string },
): Promise<{ fileId: string; kind: FileKind; filename: string; sizeBytes: number }> {
  if (!store) throw unavailable();
  if (!FILE_KINDS.includes(input.kind)) throw new ClientToolError("invalid", "A file's kind is resume or attachment.");
  const contentType = input.contentType.split(";")[0].trim().toLowerCase();
  const type = FILE_TYPES[contentType];
  if (!type) throw new ClientToolError("invalid", `Tacit takes ${TYPE_LIST} files.`);
  const filename = checkFilename(input.filename, contentType);
  if (input.contentBase64.length > FILE_BASE64_MAX) {
    throw new ClientToolError("invalid", `A file is at most ${FILE_MAX_BYTES / (1024 * 1024)} MB.`);
  }
  const bytes = decodeContent(input.contentBase64);
  if (!type.looksRight(bytes)) {
    throw new ClientToolError("invalid", `Those bytes are not a ${type.label} file. Check the file and its content_type.`);
  }

  if (ctx.accessLevel === "limited") {
    throw new ClientToolError("forbidden", "Interviewers read a candidate's resume but do not add files.");
  }
  const { data: allowed, error: permError } = await db.rpc("can_edit_person", { p_person: input.candidateId });
  if (permError) throw new Error(permError.message);
  if (allowed !== true) {
    if (!(await candidateVisible(db, ctx, input.candidateId))) throw candidateNotFound();
    throw new ClientToolError("forbidden", "You can't add files to this candidate. Their hiring team or an admin can.");
  }

  return withAudit(db, ctx, { action: "file.add", entity: "person_file" }, async () => {
    // The id is made here and the row not read back, as for a job or an offer.
    // The path is the one the insert policy requires of the row, so once the
    // insert lands it is the row's own.
    const fileId = globalThis.crypto.randomUUID();
    const storagePath = `${ctx.orgId}/${input.candidateId}/${fileId}`;
    const row: TablesInsert<"person_files"> = {
      id: fileId, person_id: input.candidateId, kind: input.kind, storage_path: storagePath,
      filename, content_type: contentType, size_bytes: bytes.length,
    };
    const { error: insertError } = await db.from("person_files").insert(row);
    if (insertError) {
      if (insertError.code === "42501") {
        throw new ClientToolError("forbidden", "You can't add files to this candidate. Their hiring team or an admin can.");
      }
      throw new Error(insertError.message);
    }
    try {
      await store.put(storagePath, bytes, contentType);
    } catch (err) {
      // No row may point at nothing: take it back, as the member (their own upload).
      const { data: undone, error: undoError } = await db.from("person_files").delete().eq("id", fileId).select("id");
      if (undoError || !undone?.length) {
        // A failed write, not a refusal: the audit claim stays open beside the stray row.
        throw new Error(`file ${fileId} was not stored and its row could not be removed: ${undoError?.message ?? "no row deleted"}`, { cause: err });
      }
      console.error(`[client-tools] file ${fileId} was not stored:`, err);
      throw new ClientToolError("invalid", "The file could not be stored, so nothing was saved. Try again.");
    }
    return {
      result: { fileId, kind: input.kind, filename, sizeBytes: bytes.length },
      entityId: fileId,
      // The filename is the member's text; the audit row keeps what was stored, not what it was called.
      after: { candidate_id: input.candidateId, kind: input.kind, content_type: contentType, size_bytes: bytes.length },
      changed: true,
    };
  });
}
