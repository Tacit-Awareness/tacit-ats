"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { selectClass } from "@/components/ui/input";
import { ACCESS_LEVELS, LEVELS, isAccessLevel } from "@/lib/client/levels";
import { cn } from "@/lib/utils";
import { setAccessAction } from "./actions";

// One member's access on the team list, for an admin: the picker shows their
// level and Save appears once it says something else. Nothing happens until
// Save. An admin stepping down asks first, since they cannot undo it themselves.

const STEP_DOWN = "You'll stop being an admin, and only another admin can change that back. Continue?";

export function AccessForm({ actorId, name, level, isSelf }: { actorId: string; name: string; level: string; isSelf: boolean }) {
  const [picked, setPicked] = useState(level);
  return (
    <form
      action={setAccessAction}
      className="flex items-center gap-2"
      onSubmit={(e) => {
        if (isSelf && !window.confirm(STEP_DOWN)) e.preventDefault();
      }}
    >
      <input type="hidden" name="actorId" value={actorId} />
      <select
        name="accessLevel"
        aria-label={`Access for ${name}`}
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        className={cn(selectClass, "w-auto")}
      >
        {/* A level this build doesn't name still shows as itself rather than as the first option. */}
        {isAccessLevel(level) ? null : <option value={level}>{level}</option>}
        {ACCESS_LEVELS.map((l) => (
          <option key={l} value={l}>
            {LEVELS[l]}
          </option>
        ))}
      </select>
      {picked !== level ? (
        <SubmitButton variant="outline" size="sm" pendingLabel="Saving…">
          Save
        </SubmitButton>
      ) : null}
    </form>
  );
}
