"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addAreas } from "@/lib/client/interviewer-profile";

// Skill tags, for the profile dialog and Onboarding's Interview skills step:
// chips, then a field where Enter adds one. Not a comma: "Go, Rust" is one area if
// they wrote it so. A paste of several lines adds each. With `name` it sends the
// tags as one line each, the shape profileFromForm reads, with what is still in the
// field as the last line, so Save does not drop it. With `busy` the field keeps its
// focus but takes no change, so a second add waits for the first to land.

export function TagInput({
  tags,
  onChange,
  label,
  id,
  name,
  placeholder,
  busy = false,
  invalid,
  describedBy,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  label: string;
  id?: string;
  name?: string;
  placeholder?: string;
  busy?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [draft, setDraft] = useState("");
  const [refused, setRefused] = useState<string | null>(null);

  const add = (raw: string) => {
    const next = addAreas(tags, raw);
    setRefused(next.refused);
    if (next.refused) return;
    setDraft("");
    if (next.areas.length !== tags.length) onChange(next.areas);
  };

  return (
    <div className="grid min-w-0 gap-1.5">
      {name ? <input type="hidden" name={name} value={(draft.trim() ? [...tags, draft] : tags).join("\n")} /> : null}
      {tags.length ? (
        <ul className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0">
          {tags.map((t) => (
            <li key={t} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-[color:var(--line-strong)] py-0.5 pr-1 pl-2.5 text-[12.5px] text-foreground">
              <span className="min-w-0 [overflow-wrap:anywhere]">{t}</span>
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove ${t}`}
                onClick={() => {
                  setRefused(null);
                  onChange(tags.filter((x) => x !== t));
                }}
                className="grid size-5 shrink-0 place-items-center rounded-full text-faint hover:bg-[color:var(--hover)] hover:text-foreground"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <span className="flex min-w-0 items-center gap-2">
        <Input
          id={id}
          value={draft}
          readOnly={busy}
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (busy || !/[\r\n]/.test(text)) return;
            e.preventDefault();
            add(text);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !draft.trim()) return;
            e.preventDefault();
            if (!busy) add(draft);
          }}
          className="w-[220px] max-w-full min-w-0"
        />
        {draft.trim() ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => add(draft)}>
            Add
          </Button>
        ) : null}
      </span>
      {refused ? (
        <span role="alert" className="text-xs text-negative">
          {refused}
        </span>
      ) : null}
    </div>
  );
}
