"use client";

import { useMemo } from "react";
import { useCommandContext, type CommandAction } from "@/components/app-shell/command-context";

// ⌘K on an open candidate, the page's or the Pipeline pop-up's: design/tats's
// "This applicant" actions as this page has them. Each one only opens or focuses
// a control already here, the same one a click or a key reaches, so the member
// still does the writing, and an action is listed only when its control is
// (`[data-command]`, which is there only where the member may use it).

const control = <T extends HTMLElement>(name: string) => document.querySelector<T>(`[data-command="${name}"]`);

export function CandidateCommands({ name, note, labels, stage, close }: { name: string; note: boolean; labels: boolean; stage: boolean; close: boolean }) {
  const ctx = useMemo(() => {
    const actions: CommandAction[] = [];
    if (note) actions.push({ label: "Write a note", hint: "C", run: () => control("note")?.focus() });
    if (labels) actions.push({ label: "Edit labels…", hint: "L", run: () => control("labels")?.click() });
    if (stage) actions.push({ label: "Move to a stage…", run: () => control("stage")?.focus() });
    if (close)
      actions.push({
        label: "Reject or withdraw…",
        run: () => {
          const fold = control<HTMLDetailsElement>("close");
          if (!fold) return;
          fold.open = true;
          fold.querySelector("select")?.focus();
        },
      });
    return { name, actions };
  }, [name, note, labels, stage, close]);
  useCommandContext(ctx);
  return null;
}
