"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Notice, Pill } from "@/components/page";
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
import { cn } from "@/lib/utils";
import { saveProfileAction } from "./actions";
import { SkillTags, Week, feedbackDue, feedbackTitle, onTimeText, type PersonFacts } from "./facts";
import { PROFILE_ERRORS, PROFILE_NOTICES, type ProfileAnswer } from "./messages";
import { TagInput } from "./tag-input";

// One interviewer in a native <dialog> (as the CRM's bulk actions are, so
// keys.ts leaves it alone), Testbench's: 16px on the box surface, the title in
// Mona Sans, Close or Cancel and the main action right-aligned over a hairline.
// It opens two ways. A row of the table opens it on what the row only hints
// at, in the row's order: the name with its Away tag, every job, every skill
// (with how they feel about interviewing and how they like to be reached),
// the weeks with their limit and the last 30 days, then feedback in full; with
// Edit profile when the member may edit it. Edit opens the form straight away. Mounted only while open, so every
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

const LABEL = "grid gap-1.5 text-[12.5px] text-faint";
const WHO_READS = "Your admins and hiring team read this. Anything left empty stays unsaid.";
const SKILLS_HINT = `Press Enter after each one, up to ${FOCUS_AREAS_MAX}, ${FOCUS_AREA_MAX} characters each.`;

type Mode = "view" | "edit";

const faint = (text: string) => <span className="text-faint">{text}</span>;

/** A label/value list for the pop-up: labels wide enough for "Booked next week" on one line, the groups apart by a hairline. */
function Facts({ items, ruled = false }: { items: [string, ReactNode, string?][]; ruled?: boolean }) {
  return (
    <dl className={cn("m-0 grid grid-cols-[136px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13px]", ruled && "border-t border-[color:var(--line)] pt-4")}>
      {items.map(([k, v, title]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere]" title={title}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * What the row only hints at. A profile the member may not read comes back as
 * none, so with no profile and no right to edit it, the profile's lines are left
 * out rather than claiming they said nothing. Away is the tag beside the name
 * in the title, as on the row, so it is not a line here.
 */
function PersonView({ profile, facts, editable }: { profile: StoredProfile | null; facts: PersonFacts; editable: boolean }) {
  const p = profile;
  const said = p !== null || editable;
  const cap = p?.weeklyCap ?? null;
  const f = facts.feedback;
  const due = f ? feedbackDue(f) : 0;
  const who: [string, ReactNode, string?][] = [
    [
      "Interviews for",
      facts.jobs.length ? (
        <ul className="m-0 grid list-none gap-1 p-0">
          {facts.jobs.map((j, i) => (
            <li key={i}>{j}</li>
          ))}
        </ul>
      ) : (
        faint("No jobs")
      ),
    ],
  ];
  if (said) {
    who.push(
      [
        "Skills",
        p?.focusAreas.length ? <SkillTags areas={p.focusAreas} /> : faint("None added"),
      ],
      ["Interviewing", p?.preference ? PREFERENCE_LABELS[p.preference] : faint("Not said")],
      ["Reach on", p?.channel ? CHANNEL_LABELS[p.channel] : faint("Not said")],
    );
  }
  const weeks: [string, ReactNode, string?][] = [
    ["Booked this week", <Week key="this" n={facts.thisWeek} cap={cap} away={facts.away !== null} />],
    ["Booked next week", <Week key="next" n={facts.nextWeek} cap={cap} />],
  ];
  if (said) weeks.push(["Weekly limit", cap === null ? faint("No limit") : `${cap} ${cap === 1 ? "interview" : "interviews"}`]);
  weeks.push(["Last 30 days", facts.last30 ? `${facts.last30} ${facts.last30 === 1 ? "interview" : "interviews"}` : faint("No interviews")]);
  const feedback: [string, ReactNode, string?][] = [];
  if (facts.feedbackShown) {
    if (!f || (due === 0 && f.notVisible === 0)) feedback.push(["Feedback", faint("None due in the last 30 days")]);
    else {
      const title = feedbackTitle(f);
      // The row's words first, then each count; a zero is a faint None, and only not filed is red.
      if (due > 0) {
        feedback.push(
          ["Feedback", onTimeText(f), title],
          ["Filed late", f.late ? String(f.late) : faint("None"), title],
          ["Not filed", f.notFiled ? <span key="not" className="text-negative">{f.notFiled}</span> : faint("None"), title],
        );
      }
      if (f.notVisible > 0) feedback.push(["Hidden from you", String(f.notVisible), "Whether they filed is hidden from you by your company's feedback setting"]);
    }
  }
  return (
    <div className="grid gap-4 px-6 pt-5 pb-6 tabular-nums">
      <Facts items={who} />
      <Facts ruled items={weeks} />
      {feedback.length ? <Facts ruled items={feedback} /> : null}
    </div>
  );
}

function ProfileDialog({
  actorId,
  name,
  self,
  profile,
  facts,
  editable,
  start,
  onClose,
}: {
  actorId: string;
  name: string;
  self: boolean;
  profile: StoredProfile | null;
  facts: PersonFacts | null;
  editable: boolean;
  start: Mode;
  onClose: (notice?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<Mode>(facts ? start : "edit");
  const switched = useRef(false);
  const [pending, startSave] = useTransition();
  const [answer, setAnswer] = useState<Extract<ProfileAnswer, { ok: false }> | "dropped" | null>(null);
  const [areas, setAreas] = useState(profile?.focusAreas ?? []);

  // The form starts on its skills field, not on a tag's remove button, which the browser would pick first.
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    if (mode === "edit") document.getElementById(FIELD_IDS.focusAreas)?.focus();
    // Only on opening: a switch between reading and editing moves focus below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Between reading and editing, the button they pressed is gone: focus goes to
  // the first field, or back to Edit profile.
  useEffect(() => {
    if (!switched.current) return;
    if (mode === "edit") document.getElementById(FIELD_IDS.focusAreas)?.focus();
    else editButton.current?.focus();
  }, [mode]);

  const field = answer && answer !== "dropped" && "invalid" in answer ? answer.field : undefined;
  useEffect(() => {
    if (field && FIELD_IDS[field]) document.getElementById(FIELD_IDS[field])?.focus();
  }, [field, answer]);

  const close = () => {
    if (!pending) onClose();
  };

  const toMode = (next: Mode) => {
    switched.current = true;
    setAnswer(null);
    setAreas(profile?.focusAreas ?? []);
    setMode(next);
  };

  // Opened on the person, Cancel goes back to them; opened on Edit, it closes.
  const cancel = () => {
    if (pending) return;
    if (facts && start === "view") toMode("view");
    else onClose();
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setAnswer(null);
    startSave(async () => {
      try {
        const saved = await saveProfileAction(form);
        if (saved.ok) onClose(PROFILE_NOTICES[saved.notice]);
        else setAnswer(saved);
      } catch {
        setAnswer("dropped");
      }
    });
  };

  const title = mode === "view" ? name : self ? "Your interviewer profile" : `${name}'s interviewer profile`;
  const refusal = answer === "dropped" ? "The connection dropped, so this may not have saved. Close this and check." : answer ? ("invalid" in answer ? answer.invalid : PROFILE_ERRORS[answer.error]) : null;
  const invalid = (name: string) => (field === name ? true : undefined);

  // On the body, not in the row that opened it: the row's hover and focus
  // styles would otherwise answer the pointer and the fields inside it.
  return createPortal(
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
      aria-describedby={mode === "edit" ? "profile-who-reads" : undefined}
      className="m-auto w-[min(520px,calc(100vw-32px))] rounded-[16px] border-0 bg-[color:var(--surface)] p-0 text-foreground shadow-[var(--box-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-6 pt-6">
        <h2 title={mode === "edit" ? WHO_READS : undefined} className="m-0 min-w-0 font-sans text-[20px] leading-[26px] font-semibold tracking-[-0.015em] [overflow-wrap:break-word]">
          {title}
        </h2>
        {/* Beside the name, as on the row. */}
        {mode === "view" && facts?.away ? <Pill>{facts.away}</Pill> : null}
        {mode === "edit" ? (
          <p id="profile-who-reads" className="sr-only">
            {WHO_READS}
          </p>
        ) : null}
      </div>
      {mode === "view" && facts ? (
        <>
          <PersonView profile={profile} facts={facts} editable={editable} />
          <div className="flex justify-end gap-2 border-t border-[color:var(--line)] px-6 py-4">
            <Button type="button" variant="outline" onClick={close}>
              Close
            </Button>
            {editable ? (
              <Button ref={editButton} type="button" onClick={() => toMode("edit")}>
                Edit profile
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="grid gap-4 px-6 pt-5">
          <input type="hidden" name="actorId" value={actorId} />
          <input type="hidden" name="version" value={profile?.updatedAt ?? ""} />
          {refusal ? <Notice tone="error">{refusal}</Notice> : null}
          <div className={LABEL}>
            <span>Skills</span>
            <TagInput
              id={FIELD_IDS.focusAreas}
              name="focusAreas"
              label="Skills"
              tags={areas}
              onChange={setAreas}
              placeholder="Add a skill"
              invalid={invalid("focusAreas")}
              describedBy="profile-focus-hint"
            />
            <span id="profile-focus-hint" className="sr-only">
              {SKILLS_HINT}
            </span>
          </div>
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
              Reach on
              <select id={FIELD_IDS.channel} name="channel" defaultValue={profile?.channel ?? ""} aria-invalid={invalid("channel")} className={selectClass}>
                <option value="">Not said</option>
                {Object.entries(CHANNEL_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Weekly interview limit
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
                title={`Up to ${WEEKLY_CAP_MAX}. Empty is no limit.`}
                aria-invalid={invalid("weeklyCap")}
              />
            </label>
            <label className={LABEL}>
              Away through
              <Input id={FIELD_IDS.awayUntil} name="awayUntil" type="date" min="0001-01-01" max="9999-12-31" defaultValue={profile?.awayUntil ?? ""} aria-invalid={invalid("awayUntil")} />
            </label>
          </div>
          <div className="-mx-6 mt-2 flex justify-end gap-2 border-t border-[color:var(--line)] px-6 py-4">
            <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </dialog>,
    document.body,
  );
}

/**
 * What a button that opens the dialog needs: the dialog's open state, the
 * save's notice for a screen reader, and focus back on the button when it
 * closes. Removing an open <dialog> drops focus on the body, where the
 * browser's own close would have put it back: a keyboard user would start
 * again from the top.
 */
function useOpener() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const status = notice ? (
    <span role="status" className="sr-only">
      {notice}
    </span>
  ) : null;
  return {
    open,
    button,
    status,
    show: () => {
      setNotice(null);
      setOpen(true);
    },
    onClose: (said?: string) => {
      setOpen(false);
      setNotice(said ?? null);
    },
  };
}

type Who = { actorId: string; name: string; self: boolean; profile: StoredProfile | null };

/** Edit: the profile's form straight away, on a row of the table or on the member's own profile card. */
export function ProfileEditor({ actorId, name, self, profile, className }: Who & { className?: string }) {
  const o = useOpener();
  return (
    <>
      {o.status}
      <button
        ref={o.button}
        type="button"
        aria-label={self ? "Edit your interviewer profile" : `Edit ${name}'s interviewer profile`}
        aria-haspopup="dialog"
        onClick={o.show}
        className={buttonVariants({ variant: "outline", size: "sm", className })}
      >
        Edit
      </button>
      {o.open ? <ProfileDialog actorId={actorId} name={name} self={self} profile={profile} facts={null} editable start="edit" onClose={o.onClose} /> : null}
    </>
  );
}

/**
 * A row's name, the button that opens the person (`data-row-open`, which
 * OpenRow presses for a click anywhere else on the row). `hover` is the name's
 * member hover card (lib/hover-card.ts's hoverAttr), raised from the name only.
 */
export function PersonButton({ actorId, name, self, profile, facts, editable, hover }: Who & { facts: PersonFacts; editable: boolean; hover: string }) {
  const o = useOpener();
  return (
    <>
      {o.status}
      <button
        ref={o.button}
        type="button"
        data-row-open
        aria-haspopup="dialog"
        onClick={o.show}
        className="-mx-1 max-w-[calc(100%+8px)] min-w-0 rounded-[6px] px-1 text-left font-medium text-foreground"
      >
        {/* Wraps between words; a word wider than the column ends in an ellipsis, never splits. */}
        <span data-hc={hover} className="block overflow-hidden text-ellipsis [overflow-wrap:normal]">
          {name}
        </span>
      </button>
      {o.open ? <ProfileDialog actorId={actorId} name={name} self={self} profile={profile} facts={facts} editable={editable} start="view" onClose={o.onClose} /> : null}
    </>
  );
}

/**
 * A table row that opens its person from anywhere on it, by pressing the
 * name's button, so the keyboard has one stop a row and every cell keeps its
 * hover title. A press that began in the pop-up (its backdrop closing it), on a
 * control, or that ends a text selection opens nothing.
 */
export function OpenRow({ className, children }: { className?: string; children: ReactNode }) {
  const down = useRef(false);
  return (
    <div
      role="row"
      className={className}
      onMouseDown={(e) => {
        down.current = !(e.target as Element).closest("dialog, button, a, input, select, textarea, label");
      }}
      onClick={(e) => {
        const began = down.current;
        down.current = false;
        if (!began || (e.target as Element).closest("dialog, button, a, input, select, textarea, label")) return;
        if (window.getSelection()?.toString()) return;
        e.currentTarget.querySelector<HTMLButtonElement>("[data-row-open]")?.click();
      }}
    >
      {children}
    </div>
  );
}
