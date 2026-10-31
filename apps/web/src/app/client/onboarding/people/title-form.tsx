"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showToast } from "@/lib/toasts";
import { saveTitleAction } from "../actions";
import { TITLE_ERRORS } from "../messages";

// A member's job title, for an admin or themselves: Save appears once it says
// something else. Nothing happens until Save. A refusal stays beside the field
// with what was typed, so this is a transition and not a form action, which
// would reset the form. Key it by the saved title, so it comes back from the
// save showing it.

const TITLE_MAX = 120;

export function TitleForm({ actorId, name, title }: { actorId: string; name: string; title: string | null }) {
  const saved = title ?? "";
  const [value, setValue] = useState(saved);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, start] = useTransition();
  return (
    <form
      className="grid min-w-0 gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          const answer = await saveTitleAction(form);
          if (answer.ok) {
            setRefusal(null);
            if (answer.changed) showToast({ text: "Title saved." });
          } else {
            setRefusal("invalid" in answer ? answer.invalid : TITLE_ERRORS[answer.error]);
          }
        });
      }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <input type="hidden" name="actorId" value={actorId} />
        <Input
          name="title"
          aria-label={`Title for ${name}`}
          placeholder="Title"
          value={value}
          maxLength={TITLE_MAX}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          className="w-[180px] max-w-full min-w-0"
        />
        {value.trim() !== saved ? (
          <Button type="submit" variant="outline" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        ) : null}
      </span>
      {refusal ? (
        <span role="alert" className="text-xs text-negative">
          {refusal}
        </span>
      ) : null}
    </form>
  );
}
