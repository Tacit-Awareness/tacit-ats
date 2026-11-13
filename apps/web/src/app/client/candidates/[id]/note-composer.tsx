"use client";

import { useActionState, useRef } from "react";
import { useKeyHelp, useKeys } from "@/components/keys";
import { Notice } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { addNoteAction } from "./actions";
import { CANDIDATE_ERRORS, type NoteState } from "./messages";

// design/tats's `.composer`: a note for the team, in a box that stays on the
// page. The box is uncontrolled, so it works with no script, and React resets
// a form to its defaultValue once its action ends: empty after a save, the
// words back after a refusal. That reset would take anything typed while the
// save runs, so the box is read-only until it ends. ⌘↵ saves and C comes here,
// as in the prototype, and the button does the same without them; its key sits
// inside it. Drawn as one Testbench field holding the box and its button. That
// notes are the team's and stay put is said on the box itself (its hover title
// and its description to a screen reader), not in a caption under it.

const FIRST: NoteState = { added: 0 };

const KEPT = "Your team can read notes. They can't be edited or deleted.";

export function NoteComposer({ candidateId, max }: { candidateId: string; max: number }) {
  const [state, action, pending] = useActionState(addNoteAction, FIRST);
  const box = useRef<HTMLTextAreaElement>(null);
  const refused = "error" in state ? state : null;

  useKeys({ c: () => box.current?.focus() });
  useKeyHelp("Candidate", [
    { keys: "C", label: "Write a note" },
    { keys: "⌘↵", label: "Save the note" },
  ]);

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="candidateId" value={candidateId} />
      {refused ? <Notice tone="error">{CANDIDATE_ERRORS[refused.error]}</Notice> : null}
      <div className="rounded-[10px] bg-[color:var(--paper)] shadow-[inset_0_0_0_1px_var(--field)] transition-shadow duration-150 hover:shadow-[inset_0_0_0_1px_var(--muted-text)] focus-within:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_rgba(34,35,38,0.12)] focus-within:hover:shadow-[inset_0_0_0_1.5px_var(--ink),0_0_0_3px_rgba(34,35,38,0.12)]">
        <label htmlFor="candidate-note" className="sr-only">
          Add a note
        </label>
        <textarea
          ref={box}
          id="candidate-note"
          data-command="note"
          name="text"
          rows={2}
          required
          maxLength={max}
          defaultValue={refused?.text ?? ""}
          readOnly={pending}
          placeholder="Add a note…"
          title={KEPT}
          aria-describedby="candidate-note-kept"
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
            e.preventDefault();
            if (!pending) e.currentTarget.form?.requestSubmit();
          }}
          className="block min-h-16 w-full resize-y rounded-[10px] border-0 bg-transparent px-3.5 pt-3 pb-1 font-sans text-[14px] leading-[22px] shadow-none outline-none placeholder:font-mono placeholder:text-[13px] placeholder:text-faint focus-visible:outline-none"
        />
        <span id="candidate-note-kept" className="sr-only">
          {KEPT}
        </span>
        <div className="flex items-center justify-between gap-3 px-2 pt-1 pb-2 pl-3.5">
          <span role="status" className="text-[12.5px] text-faint">
            {state.added > 0 && !refused ? "Note added." : ""}
          </span>
          <SubmitButton variant="outline" size="sm" pendingLabel="Adding…" title="Add note (⌘↵)" className="flex-none">
            Add note
            <kbd aria-hidden className="-mr-1 inline-grid h-5 min-w-5 place-items-center rounded-[4px] px-1 font-mono text-[11px] shadow-[inset_0_0_0_1px_currentColor] opacity-70">
              ⌘↵
            </kbd>
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
