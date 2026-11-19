"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { fileHref, type ViewerFile } from "@/lib/client/file-view-rules";

// The middle of Triage (design/tacit-tickets's PdfReader, filling the pane):
// the applicant's files, resumes first, one at a time, the browser drawing each
// as files/viewer.tsx does. Every frame loads through /client/files/[id]?view=1,
// which reads the row on the member's own token before sending the browser to a
// five-minute link. A file the browser can't show offers the download.

export function ResumePane({ name, files }: { name: string; files: ViewerFile[] }) {
  const [at, setAt] = useState(0);
  const open = files[Math.min(at, files.length - 1)];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-quiet flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line pr-2 pl-5 text-mute">
        <span className="mr-1 truncate font-medium text-ink">{name}</span>
        {files.map((f, i) => (
          <button
            key={f.fileId}
            type="button"
            onClick={() => setAt(i)}
            aria-pressed={f === open}
            title={`${f.filename}, ${f.sub.replace(/\s+·\s+/g, ", ")}`}
            className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 transition-colors ${f === open ? "bg-sel text-ink" : "text-mute hover:text-ink"}`}
          >
            {f.label}
          </button>
        ))}
        {open && (
          <a href={fileHref(open.fileId)} className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-sel hover:text-ink" aria-label={`Download ${open.filename}`} title="Download">
            <Download size={15} />
          </a>
        )}
      </div>
      <div className="min-h-0 flex-1 bg-well">
        {!open ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl bg-sel text-mute">
              <FileText size={18} />
            </span>
            <div className="mt-4 font-medium text-ink">No resume on file</div>
            <p className="mt-1.5 max-w-[260px] text-mute">Ask for one in your reply, or add it to their files on their page.</p>
          </div>
        ) : open.preview === "pdf" || open.preview === "text" ? (
          <iframe key={open.fileId} src={fileHref(open.fileId, true)} title={open.filename} className="h-full w-full border-0" sandbox={open.preview === "text" ? "" : undefined} />
        ) : open.preview === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stored file through its checked link, not a page asset
          <img key={open.fileId} src={fileHref(open.fileId, true)} alt={open.filename} className="mx-auto max-h-full max-w-full object-contain p-6" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <div className="font-medium text-ink">{open.filename}</div>
            <p className="mt-1.5 text-mute">Your browser can&apos;t show this file here.</p>
            <a href={fileHref(open.fileId)} className="mt-4 flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-ink transition-colors hover:bg-hover">
              <Download size={14} /> Download
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
