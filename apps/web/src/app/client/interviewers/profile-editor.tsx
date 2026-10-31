"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Notice } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import {
  CHANNEL_LABELS,
  FOCUS_AREAS_MAX,
  FOCUS_AREA_MAX,
  PREFERENCE_LABELS,
  WEEKLY_CAP_MAX,
  type StoredProfile,
} from "@/lib/client/interviewer-profile";
import { saveProfileAction } from "./actions";
import { PROFILE_ERRORS, PROFILE_NOTICES, type ProfileAnswer } from "./messages";
import { TagInput } from "./tag-input";

// A member's interviewer profile, in a native <dialog> as the CRM's bulk
// actions are, so keys.ts leaves it alone. Mounted only while open, so every
// open starts from what the page last read. The fields but the tags are
// uncontrolled and the form is submitted by hand, not through useActionState: React resets a
// form when its action ends, and a refusal has to leave what they typed. The
// version is the prop's, and a refused save refreshes the page, so Save again
// replaces what someone else saved knowingly, not by accident.

const FIELD_IDS: Record<string, string> = {
  preference: "profile-preference",
  weeklyCap: "profile-cap",
  focusAreas: "profile-focus",
  channel: "profile-channel",
  awayUntil: "profile-away",
};

const LABEL = "grid gap-1 text-[12.5px] text-muted-foreground";

function ProfileDialog({ actorId, name, self, profile, onClose }: { actorId: string; name: string; self: boolean; profile: StoredProfile | null; onClose: (notice?: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  const [answer, setAnswer] = useState<Extract<ProfileAnswer, { ok: false }> | "dropped" | null>(null);
  const [areas, setAreas] = useState(profile?.focusAreas ?? []);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const field = answer && answer !== "dropped" && "invalid" in answer ? answer.field : undefined;
  useEffect(() => {
    if (field && FIELD_IDS[field]) document.getElementById(FIELD_IDS[field])?.focus();
  }, [field, answer]);

  const close = () => {
    if (!pending) onClose();
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setAnswer(null);
    start(async () => {
      try {
        const saved = await saveProfileAction(form);
        if (saved.ok) onClose(PROFILE_NOTICES[saved.notice]);
        else setAnswer(saved);
      } catch {
        setAnswer("dropped");
      }
    });
  };

  const title = self ? "Your interviewer profile" : `${name}'s interviewer profile`;
  const refusal = answer === "dropped" ? "The connection dropped, so this may not have saved. Close this and check." : answer ? ("invalid" in answer ? answer.invalid : PROFILE_ERRORS[answer.error]) : null;
  const invalid = (name: string) => (field === name ? true : undefined);

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      // The browser lets a cancel be refused only once: a second Esc closes it anyway.
      // Mid-save it comes straight back, or the answer would land in a closed dialog.
      onClose={() => (pending ? dialog.current?.showModal() : onClose())}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="m-auto w-[min(440px,calc(100vw-32px))] border border-[color:var(--line-strong)] bg-raised p-0 text-foreground shadow-[var(--pop-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      <div className="grid gap-0.5 border-b border-[color:var(--line)] px-4 py-3">
        <h2 className="m-0 text-[14px] font-semibold">{title}</h2>
        <p className="m-0 text-[12.5px] text-muted-foreground">Your admins and hiring team read this. Anything left empty stays unsaid.</p>
      </div>
      <form onSubmit={submit} className="grid gap-3 p-4">
        <input type="hidden" name="actorId" value={actorId} />
        <input type="hidden" name="version" value={profile?.updatedAt ?? ""} />
        {refusal ? <Notice tone="error">{refusal}</Notice> : null}
        <div className="grid grid-cols-2 gap-3">
          <label className={LABEL}>
            Interviewing
            <select id={FIELD_IDS.preference} name="preference" defaultValue={profile?.preference ?? ""} aria-invalid={invalid("preference")} className={selectClass}>
              <option value="">Not said</option>
              {Object.entries(PREFERENCE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Most interviews a week
            <Input
              id={FIELD_IDS.weeklyCap}
              name="weeklyCap"
              type="number"
              inputMode="numeric"
              min={0}
              max={WEEKLY_CAP_MAX}
              step={1}
              defaultValue={profile?.weeklyCap ?? ""}
              placeholder="No limit"
              aria-invalid={invalid("weeklyCap")}
            />
          </label>
        </div>
        <div className={LABEL}>
          <span>Knows</span>
          <TagInput
            id={FIELD_IDS.focusAreas}
            name="focusAreas"
            label="Knows"
            tags={areas}
            onChange={setAreas}
            placeholder="Distributed systems"
            invalid={invalid("focusAreas")}
            describedBy="profile-focus-hint"
          />
          <span id="profile-focus-hint" className="text-xs text-faint">
            Enter after each one, up to {FOCUS_AREAS_MAX}, {FOCUS_AREA_MAX} characters each.
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={LABEL}>
            Reach
            <select id={FIELD_IDS.channel} name="channel" defaultValue={profile?.channel ?? ""} aria-invalid={invalid("channel")} className={selectClass}>
              <option value="">Not said</option>
              {Object.entries(CHANNEL_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Away through
            <Input id={FIELD_IDS.awayUntil} name="awayUntil" type="date" min="0001-01-01" max="9999-12-31" defaultValue={profile?.awayUntil ?? ""} aria-invalid={invalid("awayUntil")} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export function ProfileEditor({ actorId, name, self, profile }: { actorId: string; name: string; self: boolean; profile: StoredProfile | null }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Removing an open <dialog> drops focus on the body, where the browser's own
  // close would have put it back: a keyboard user would start again from the top.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return (
    <>
      {notice ? (
        <span role="status" className="sr-only">
          {notice}
        </span>
      ) : null}
      <button
        ref={button}
        type="button"
        aria-label={self ? "Edit your interviewer profile" : `Edit ${name}'s interviewer profile`}
        onClick={() => {
          setNotice(null);
          setOpen(true);
        }}
        className={buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground" })}
      >
        Edit
      </button>
      {open ? (
        <ProfileDialog
          actorId={actorId}
          name={name}
          self={self}
          profile={profile}
          onClose={(said) => {
            setOpen(false);
            setNotice(said ?? null);
          }}
        />
      ) : null}
    </>
  );
}
