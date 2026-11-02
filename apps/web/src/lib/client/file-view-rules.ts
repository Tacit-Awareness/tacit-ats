import type { clientTools } from "@tacit-ats/core";

/**
 * The file viewer's and the upload form's pure half (app/client/files/
 * viewer.tsx, candidates/[id]/file-upload.tsx): type-only imports, so client
 * components may take values from here. What may be uploaded is core's
 * (FILE_TYPES, FILE_MAX_BYTES), passed down as props by the server.
 */

/** How the viewer shows a file: a PDF or plain text in a frame, an image as one, or not at all (Word: the browser can't, so it is a download). */
export type Preview = "pdf" | "text" | "image" | "none";

export function previewOf(contentType: string | null): Preview {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type === "text/plain") return "text";
  if (type === "image/png" || type === "image/jpeg") return "image";
  return "none";
}

/** A file's route: the download as it was, or `?view=1` for a link the browser shows in place. */
export const fileHref = (fileId: string, view = false) => `/client/files/${fileId}${view ? "?view=1" : ""}`;

export const fileSize = (bytes: number | null) =>
  bytes === null ? null : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** One file as the viewer draws it. */
export type ViewerFile = {
  fileId: string;
  /** "Resume" or "Attachment". */
  label: string;
  filename: string;
  preview: Preview;
  /** Its size, who added it and when: "212 KB · Sam · 3d ago". */
  sub: string;
};

/** A candidate's files for the viewer, resumes first, each kind newest first as core lists them. */
export function viewerFiles(files: clientTools.CandidateFile[], when: (iso: string) => string): ViewerFile[] {
  const rank = (f: clientTools.CandidateFile) => (f.kind === "resume" ? 0 : 1);
  return [...files]
    .sort((a, b) => rank(a) - rank(b))
    .map((f) => ({
      fileId: f.fileId,
      label: f.kind === "resume" ? "Resume" : "Attachment",
      filename: f.filename,
      preview: previewOf(f.contentType),
      sub: [fileSize(f.sizeBytes), f.uploadedBy, when(f.uploadedAt)].filter(Boolean).join(" · "),
    }));
}

/** What the browser already knows about a picked file, checked before it is sent: null when it may go. */
export function pickedFileError(file: { name: string; size: number }, extensions: string[], maxBytes: number): FileError | null {
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!extensions.includes(ext)) return "file_type";
  if (file.size === 0) return "file_empty";
  if (file.size > maxBytes) return "file_big";
  return null;
}

/** The upload form's answers. It answers in place, so none of these, nor the filename, rides in a URL. */
export const FILE_ERRORS = {
  file_missing: "Pick a file first.",
  file_type: "Tacit takes PDF, Word (.doc, .docx), plain text, PNG and JPEG files.",
  file_empty: "That file is empty.",
  file_big: "A file is at most 3 MB.",
  file_mismatch: "That file's contents aren't what its name says. Check the file and try again.",
  file_forbidden: "You can't add files to this candidate. Their hiring team or an admin can.",
  file_gone: "That candidate isn't one you can see any more. Nothing was saved.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Nothing was saved. Try again later.",
  failed: "That didn't work, so nothing was saved. Try again.",
} as const;

export type FileError = keyof typeof FILE_ERRORS;

/** How many files this form has added, and why the last one was refused, if it was. */
export type FileUploadState = { added: number; error?: FileError };
