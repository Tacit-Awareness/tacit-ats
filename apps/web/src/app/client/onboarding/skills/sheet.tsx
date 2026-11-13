"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Chip, Chips, Count, Pill } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyRun, runState, type RunState, type SheetPerson, type SheetType, type SkillSheet } from "@/lib/client/skill-sheet";
import { showToast } from "@/lib/toasts";
import { cn } from "@/lib/utils";
import { TagInput } from "../../interviewers/tag-input";
import type { Refused } from "../step-refusal";
import { addTypeAction, archiveTypeAction, renameTypeAction, saveSkillsAction, setRunAction, setStarAction } from "./actions";
import { StepCard } from "../step-card";

// design/tats's `#setup~skills`: the interview types a company runs, then a row
// per person under one head (their name and teams, their skills, the types they
// run), with a star for who to ask first. Every
// change saves at once, shows at once, and goes back on a refusal, which a toast
// explains. The prototype's one button cycles off, on and starred; here the star is
// its own button, so each state says what it does. Nothing is seeded.

const DROPPED = "The connection dropped, so this may not have saved. Reload and check.";
const ADD_NOTICES = { created: "Interview type added.", exists: "That interview type was already here.", restored: "That interview type was archived, so it's back, with who ran it." };

/** Runs a save and says what it refused. The answer when it went through, or null. */
async function said<T extends { ok: true }>(run: () => Promise<T | Refused>): Promise<T | null> {
  try {
    const answer = await run();
    if (answer.ok) return answer;
    showToast({ text: answer.error, tone: "error" });
  } catch {
    showToast({ text: DROPPED, tone: "error" });
  }
  return null;
}

function TypeRow({ type, editable }: { type: SheetType; editable: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(type.name);
  const [pending, start] = useTransition();
  return (
    <li className="flex min-h-12 min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[color:var(--line)] py-2 text-[13px] last:border-b-0">
      {renaming ? (
        <form
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              if (await said(() => renameTypeAction({ typeId: type.id, name }))) setRenaming(false);
            });
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label={`New name for ${type.name}`} autoComplete="off" className="w-[220px] max-w-full" />
          <Button type="submit" size="sm" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setName(type.name);
              setRenaming(false);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-[1_1_180px] font-medium [overflow-wrap:anywhere]">{type.name}</span>
          {type.interviewers ? (
            <span className="text-[12px] text-faint tabular-nums">{`${type.interviewers} ${type.interviewers === 1 ? "person runs" : "people run"} this`}</span>
          ) : (
            <Pill tone="amber">No one runs this yet</Pill>
          )}
          {editable ? (
            <span className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" aria-label={`Rename ${type.name}`} onClick={() => setRenaming(true)}>
                Rename
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Archive ${type.name}`}
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`Archive ${type.name}? Add the same name later to bring it back, with who ran it.`)) {
                    start(async () => void (await said(() => archiveTypeAction({ typeId: type.id }))));
                  }
                }}
              >
                Archive
              </Button>
            </span>
          ) : null}
        </>
      )}
    </li>
  );
}

function AddType({ first }: { first: boolean }) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex min-w-0 flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const answer = await said(() => addTypeAction({ name }));
          if (!answer) return;
          showToast({ text: ADD_NOTICES[answer.outcome] });
          setName("");
        });
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Interview type name" placeholder="Coding, System design…" autoComplete="off" className="w-[220px] max-w-full" />
      <Button type="submit" size="sm" variant={first ? "default" : "outline"} disabled={pending || !name.trim()}>
        {pending ? "Adding…" : "Add an interview type"}
      </Button>
    </form>
  );
}

// Drawn, not a ★ character, so it sits on the chip's centre line in any font.
function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-[13px]" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" aria-hidden>
      <path d="m8 1.9 1.8 3.8 4.1.5-3 2.9.8 4.1L8 11.2l-3.7 2 .8-4.1-3-2.9 4.1-.5z" />
    </svg>
  );
}

function RunChip({ person, type, state, change }: { person: string; type: SheetType; state: RunState; change?: (next: RunState) => void }) {
  if (!change) {
    if (state === "off") return null;
    return <Chip title={state === "starred" ? "Asked first" : undefined}>{`${state === "starred" ? "★ " : ""}${type.name}`}</Chip>;
  }
  const on = state !== "off";
  // Testbench's `.chip-btn`: an outline, the ink edge when it is on; dashed while it is off.
  return (
    <span
      className={cn(
        "inline-flex h-[30px] max-w-full min-w-0 items-center rounded-[7px] font-mono text-[12.5px] transition-[background-color,box-shadow,color] duration-150",
        on ? "bg-[color:var(--paper)] text-foreground shadow-[inset_0_0_0_1.5px_var(--ink)]" : "border border-dashed border-[color:var(--line-strong)] text-muted-foreground hover:bg-[color:var(--hover)] hover:text-foreground",
      )}
    >
      {on ? (
        <button
          type="button"
          aria-pressed={state === "starred"}
          aria-label={state === "starred" ? `${person} is asked first for ${type.name}. Stop` : `Ask ${person} first for ${type.name}`}
          title={state === "starred" ? "Asked first" : "Ask them first"}
          onClick={() => change(state === "starred" ? "runs" : "starred")}
          className={cn("grid h-full place-items-center rounded-l-[7px] pr-1.5 pl-2.5", state === "starred" ? "text-foreground" : "text-faint hover:text-foreground")}
        >
          <Star filled={state === "starred"} />
        </button>
      ) : null}
      <button type="button" aria-pressed={on} aria-label={`${person} runs ${type.name}`} title={type.name} onClick={() => change(on ? "off" : "runs")} className={cn("h-full min-w-0 truncate rounded-r-[7px] pr-2.5", !on && "rounded-l-[7px] pl-2.5")}>
        {type.name}
      </button>
    </span>
  );
}

function PersonCard({ person, types, editable }: { person: SheetPerson; types: SheetType[]; editable: boolean }) {
  const [skills, showSkills] = useOptimistic(person.skills);
  const [runs, showRun] = useOptimistic(person.runs, (now, c: { typeId: string; next: RunState }) => applyRun(now, c.typeId, c.next));
  const [saving, startSkills] = useTransition();
  const [, startRun] = useTransition();

  const change = (type: SheetType, next: RunState) => {
    const was = runState(runs, type.id);
    startRun(async () => {
      showRun({ typeId: type.id, next });
      await said(() =>
        was !== "off" && next !== "off"
          ? setStarAction({ typeId: type.id, memberId: person.id, starred: next === "starred" })
          : setRunAction({ typeId: type.id, memberId: person.id, on: next !== "off" }),
      );
    });
  };

  return (
    <li className={cn("grid min-w-0 items-start gap-x-6 gap-y-2.5 border-b border-[color:var(--line)] py-3.5 last:border-b-0 last:pb-0", columns(types.length > 0))}>
      <span className="grid min-w-0 gap-0.5 pt-2 text-[13px] md:pt-[7px]">
        <b className="font-medium [overflow-wrap:anywhere]">{person.name}</b>
        {person.teams.length ? <span className="text-[12px] text-faint [overflow-wrap:anywhere]">{person.teams.join(", ")}</span> : null}
      </span>
      <div className="grid min-w-0 gap-1">
        {/* The column's head says it from a tablet up; a phone has no head row. */}
        <span className="text-[12px] text-faint md:sr-only">Skills</span>
        {editable ? (
          <TagInput
            tags={skills}
            label={`Skill for ${person.name}`}
            placeholder="Add a skill"
            busy={saving}
            onChange={(next) =>
              startSkills(async () => {
                showSkills(next);
                await said(() => saveSkillsAction({ memberId: person.id, version: person.version, skills: next }));
              })
            }
          />
        ) : skills.length ? (
          <Chips className="md:min-h-9">
            {skills.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </Chips>
        ) : (
          <span className="text-[13px] text-faint md:leading-9">None yet</span>
        )}
      </div>
      {types.length ? (
        <div className="grid min-w-0 gap-1">
          <span className="text-[12px] text-faint md:sr-only">Interviews</span>
          <Chips className="min-w-0 md:min-h-9">
            {types.map((t) => (
              <RunChip key={t.id} person={person.name} type={t} state={runState(runs, t.id)} change={editable ? (next) => change(t, next) : undefined} />
            ))}
            {!editable && !Object.keys(runs).length ? <span className="text-[13px] text-faint">None yet</span> : null}
          </Chips>
        </div>
      ) : null}
    </li>
  );
}

/** The person, their skills and, once there are types, the ones they run: one template for the head and each row. */
const columns = (withTypes: boolean) => (withTypes ? "md:grid-cols-[168px_minmax(0,1fr)_minmax(0,1.3fr)]" : "md:grid-cols-[168px_minmax(0,1fr)]");

export function SkillsStep({ sheet, editable }: { sheet: SkillSheet; editable: boolean }) {
  const { people, types } = sheet;
  return (
    <>
      <StepCard
        title={
          <>
            Interview types{types.length ? <Count>{types.length}</Count> : null}
          </>
        }
        sub="The kinds of interview your company runs. Each person then says which they run."
      >
        {types.length ? (
          <ul className="m-0 grid list-none p-0">
            {types.map((t) => (
              <TypeRow key={`${t.id}:${t.name}`} type={t} editable={editable} />
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13px] text-faint">{editable ? "Add an interview type to say who runs it." : "No interview types yet."}</p>
        )}
        {editable ? <AddType first={!types.length} /> : null}
      </StepCard>
      <StepCard
        title="Say what each person interviews for"
        sub={editable ? "Tap an interview type if they run it, and star it to ask them first." : "What each person knows, and the interview types they run. A star means ask them first."}
      >
        <div className="grid min-w-0">
          {/* Heads once, over the columns, as the Teams matrix's: each row's own label is for a screen reader. */}
          <div aria-hidden className={cn("-mx-5 hidden gap-x-6 border-b border-[color:var(--line)] px-5 pb-2.5 text-[12px] text-faint sm:-mx-7 sm:px-7 md:grid", columns(types.length > 0))}>
            <span />
            <span>Skills</span>
            {types.length ? <span>Interviews</span> : null}
          </div>
          <ul className="m-0 grid list-none p-0">
            {people.map((p) => (
              <PersonCard key={p.id} person={p} types={types} editable={editable} />
            ))}
          </ul>
        </div>
      </StepCard>
    </>
  );
}
