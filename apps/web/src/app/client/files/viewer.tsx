"use client";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { fileHref, type ViewerFile } from "@/lib/client/file-view-rules";
import { cn } from "@/lib/utils";

// design/tats's document viewer (`.dv`): a rail with a page for each file,
// the open one in the middle, and a small floating bar over it. Real files,
// not the prototype's drawn pages, so the browser draws them: a PDF in a frame
// (its own viewer has the zoom and the page count), plain text in a sandboxed
// frame, an image as an image. A Word file has no in-browser view, so it says
// so and offers the download. Every frame and image loads through
// /client/files/[id]?view=1, which reads the row on the member's own token
// and sends the browser to a five-minute link on Storage's origin, never this
// app's, made when the frame opens.
// In Testbench's language it is a recessed well inside its card: the rail's
// open page is ringed in ink, and the bar is a small raised toolbar of ghost
// buttons (Open, Download) beside the file's name.

const bar = buttonVariants({ variant: "ghost", size: "sm", className: "h-7 px-2" });

export function FileViewer({ files, label = "Files" }: { files: ViewerFile[]; label?: string }) {
  const [at, setAt] = useState(0);
  const open = files[Math.min(at, files.length - 1)];
  if (!open) return null;
  const many = files.length > 1;

  return (
    // The well's edge is a border, not an inset ring: a white frame inside would paint over a ring.
    <div className="overflow-hidden rounded-[10px] border border-[color:var(--line)] bg-[color:var(--soft)]">
      <div className={cn("flex min-h-0 flex-col", many && "md:flex-row")}>
        {many ? (
          <nav
            aria-label={label}
            className="flex gap-1 overflow-x-auto border-b border-[color:var(--line)] p-2 md:w-[124px] md:flex-none md:flex-col md:gap-2 md:overflow-x-visible md:border-r md:border-b-0 md:px-2 md:py-3"
          >
            {files.map((f, i) => (
              <button
                key={f.fileId}
                type="button"
                aria-current={f === open ? "true" : undefined}
                onClick={() => setAt(i)}
                title={`${f.filename}\n${f.sub}`}
                className={cn(
                  "grid flex-none justify-items-center gap-1.5 rounded-[8px] px-1.5 py-1.5 text-center text-[11.5px] leading-[1.25] text-faint transition-colors hover:bg-[color:var(--hover)] hover:text-foreground",
                  f === open && "text-foreground",
                )}
              >
                {/* design/tats's `.dv-mini`: a page drawn in five lines */}
                <span
                  aria-hidden
                  className={cn(
                    "hidden aspect-[8.5/11] w-[62px] content-start gap-1 rounded-[3px] bg-[color:var(--paper)] px-[7px] py-2 md:grid",
                    f === open ? "shadow-[0_0_0_1.5px_var(--ink)]" : "shadow-[var(--shadow-sm)]",
                  )}
                >
                  <i className="h-[3px] w-3/5 rounded-[1px] bg-[color:var(--line-strong)]" />
                  <i className="h-[2px] rounded-[1px] bg-[color:var(--soft-strong)]" />
                  <i className="h-[2px] w-4/5 rounded-[1px] bg-[color:var(--soft-strong)]" />
                  <i className="h-[2px] rounded-[1px] bg-[color:var(--soft-strong)]" />
                  <i className="h-[2px] rounded-[1px] bg-[color:var(--soft-strong)]" />
                </span>
                <span className="max-w-[100px] truncate">{f.label}</span>
              </button>
            ))}
          </nav>
        ) : null}

        <div className="relative min-w-0 flex-1">
          {/* design/tats's `.dv-float`, as a small raised toolbar */}
          <div className="absolute top-2 right-2 z-[2] flex h-9 max-w-[calc(100%-16px)] items-center gap-0.5 rounded-[10px] bg-[color:var(--raised)] px-1 shadow-[var(--shadow-sm)]">
            <span className="min-w-0 truncate px-2 text-[12.5px] text-foreground" title={`${open.filename}\n${open.sub}`}>
              {open.filename}
            </span>
            <i aria-hidden className="mx-0.5 h-[18px] w-px flex-none bg-[color:var(--line)]" />
            {open.preview !== "none" ? (
              <a href={fileHref(open.fileId, true)} target="_blank" rel="noopener noreferrer" className={bar} title="Open in a new tab">
                Open
              </a>
            ) : null}
            <a href={fileHref(open.fileId)} className={bar} title={`Download ${open.filename}`}>
              Download
            </a>
          </div>

          {open.preview === "pdf" || open.preview === "text" ? (
            <iframe
              key={open.fileId}
              src={fileHref(open.fileId, true)}
              title={`${open.label}: ${open.filename}`}
              loading="lazy"
              // Plain text needs nothing; a PDF needs the browser's own viewer, which a sandbox turns off.
              sandbox={open.preview === "text" ? "" : undefined}
              className="block h-[min(760px,80vh)] w-full border-0 bg-[color:var(--n0)] pt-[52px]"
            />
          ) : open.preview === "image" ? (
            <div className="grid h-[min(760px,80vh)] place-items-center overflow-auto px-4 pt-[60px] pb-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- a five-minute signed link, not a page asset */}
              <img key={open.fileId} src={fileHref(open.fileId, true)} alt={`${open.label}: ${open.filename}`} className="max-h-full max-w-full rounded-[3px] shadow-[var(--shadow)]" />
            </div>
          ) : (
            <div className="grid h-[260px] place-items-center px-6 pt-[52px] text-center">
              <div className="grid gap-1">
                <p className="m-0 text-[13px] text-foreground">Word files don&apos;t open in the browser.</p>
                <p className="m-0 text-[12.5px] text-faint">Download it to read it. The link works for five minutes.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
