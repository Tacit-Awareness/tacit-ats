"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { selectClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FILE_ERRORS, pickedFileError, type FileError, type FileUploadState } from "@/lib/client/file-view-rules";
import { addFileAction } from "./actions";

// Add a file to the candidate, for whoever can change their record
// (can_edit_person; read.ts asks). design/tats attaches by dropping a file on
// a box; this is the same box with the browser's own picker in it. What the
// browser knows (the extension, the size) is checked on pick, so a 40 MB scan
// isn't sent only to be refused; the server checks it all again, the bytes
// too, then core's addFile stores it. It answers in place: after a save the
// form is drawn anew (its key), so the picker is empty. Drawn as a dashed well
// with Testbench's buttons in it; what it takes (the kinds, the size, that files
// stay) is the well's hover title and its description to a screen reader, and
// the line under it only speaks once a file is added.

const FIRST: FileUploadState = { added: 0 };

export function FileUpload({ candidateId, accept, extensions, maxBytes }: { candidateId: string; accept: string; extensions: string[]; maxBytes: number }) {
  const [state, action] = useActionState(addFileAction, FIRST);
  const takes = `PDF, Word, plain text, PNG or JPEG, up to ${Math.round(maxBytes / (1024 * 1024))} MB. Files can't be replaced or deleted.`;
  const [picked, setPicked] = useState<FileError | null>(null);
  // Picking another file puts a refusal of the last one away.
  const [dismissed, setDismissed] = useState<FileUploadState | null>(null);
  const error = picked ?? (state !== dismissed ? state.error : null) ?? null;

  return (
    <form key={state.added} action={action} className="grid gap-2">
      <input type="hidden" name="candidateId" value={candidateId} />
      {error ? <Notice tone="error">{FILE_ERRORS[error]}</Notice> : null}
      <div
        title={takes}
        className="flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-[color:var(--line-strong)] bg-[color:var(--soft)] py-2 pr-2 pl-2"
      >
        <label className="min-w-0 flex-1 text-[13px]">
          <span className="sr-only">File</span>
          <input
            type="file"
            name="file"
            required
            accept={accept}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              setDismissed(state);
              setPicked(f ? pickedFileError(f, extensions, maxBytes) : null);
            }}
            aria-describedby={`${candidateId}-file-takes`}
            className="block w-full min-w-0 cursor-pointer text-[12.5px] text-muted-foreground file:mr-3 file:h-[30px] file:cursor-pointer file:rounded-[6px] file:border-0 file:bg-[color:var(--paper)] file:px-2.5 file:font-mono file:text-[12.5px] file:font-medium file:text-foreground file:shadow-[var(--btn-ring)] hover:file:bg-[color:var(--hover)]"
          />
        </label>
        <span id={`${candidateId}-file-takes`} className="sr-only">
          {takes}
        </span>
        <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          As
          <select name="kind" defaultValue="resume" className={cn(selectClass, "h-[30px] w-auto px-2 text-[12.5px]")}>
            <option value="resume">Resume</option>
            <option value="attachment">Attachment</option>
          </select>
        </label>
        <SubmitButton variant="outline" size="sm" pendingLabel="Adding…" disabled={picked !== null} className="flex-none">
          Add file
        </SubmitButton>
      </div>
      <p role="status" className="m-0 text-[12.5px] text-faint empty:hidden">
        {state.added > 0 && !state.error ? "File added." : ""}
      </p>
    </form>
  );
}
