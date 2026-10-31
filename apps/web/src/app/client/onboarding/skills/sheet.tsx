"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Avatar, Chip, Chips, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyRun, runState, type RunState, type SheetPerson, type SheetType, type SkillSheet } from "@/lib/client/skill-sheet";
import { showToast } from "@/lib/toasts";
import { cn } from "@/lib/utils";
import { TagInput } from "../../interviewers/tag-input";
import type { Refused } from "../step-refusal";
import { addTypeAction, archiveTypeAction, renameTypeAction, saveSkillsAction, setRunAction, setStarAction } from "./actions";

// design/tats's `#setup~skills`: the interview types a company runs, then each
// person's skills and the types they run, with a star for who to ask first. Every
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
    <li className="flex min-h-10 min-w-0 flex-wrap items-center gap-2 border-b border-[color:var(--line)] py-1.5 text-[13px] last:border-b-0">
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
          <span className={cn("text-xs tabular-nums", type.interviewers ? "text-faint" : "text-[color:var(--red)]")}>
            {type.interviewers ? `${type.interviewers} ${type.interviewers === 1 ? "person runs" : "people run"} this` : "No one runs this yet"}
          </span>
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

function RunChip({ person, type, state, change }: { person: string; type: SheetType; state: RunState; change?: (next: RunState) => void }) {
  if (!change) {
    if (state === "off") return null;
    return <Chip title={state === "starred" ? "Asked first" : undefined}>{`${state === "starred" ? "★ " : ""}${type.name}`}</Chip>;
  }
  const on = state !== "off";
  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-full min-w-0 items-center rounded-full border text-[12.5px]",
        on ? "border-[color:var(--line-strong)] bg-[color:var(--soft)] text-foreground" : "border-dashed border-[color:var(--line-strong)] text-muted-foreground",
      )}
    >
      {on ? (
        <button
          type="button"
          aria-pressed={state === "starred"}
          aria-label={state === "starred" ? `${person} is asked first for ${type.name}. Stop` : `Ask ${person} first for ${type.name}`}
          title={state === "starred" ? "Asked first" : "Ask them first"}
          onClick={() => change(state === "starred" ? "runs" : "starred")}
          className={cn("h-full pr-1 pl-2.5 leading-none", state === "starred" ? "text-[color:var(--accent)]" : "text-faint hover:text-foreground")}
        >
          {state === "starred" ? "★" : "☆"}
        </button>
      ) : null}
      <button type="button" aria-pressed={on} aria-label={`${person} runs ${type.name}`} title={type.name} onClick={() => change(on ? "off" : "runs")} className={cn("h-full min-w-0 truncate pr-2.5", !on && "pl-2.5")}>
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
    <li className="grid min-w-0 gap-2.5 border-b border-[color:var(--line)] py-3 last:border-b-0">
      <span className="flex min-w-0 items-center gap-2.5 text-[13px]">
        <Avatar name={person.name} />
        <span className="grid min-w-0">
          <b className="font-medium [overflow-wrap:anywhere]">{person.name}</b>
          {person.teams.length ? <span className="text-xs text-faint [overflow-wrap:anywhere]">{person.teams.join(" · ")}</span> : null}
        </span>
      </span>
      <div className="grid min-w-0 gap-1">
        <span className="text-xs text-faint">Skills</span>
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
          <Chips>
            {skills.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </Chips>
        ) : (
          <span className="text-[13px] text-muted-foreground">None yet</span>
        )}
      </div>
      {types.length ? (
        <div className="grid min-w-0 gap-1">
          <span className="text-xs text-faint">Interviews</span>
          <Chips className="min-w-0">
            {types.map((t) => (
              <RunChip key={t.id} person={person.name} type={t} state={runState(runs, t.id)} change={editable ? (next) => change(t, next) : undefined} />
            ))}
            {!editable && !Object.keys(runs).length ? <span className="text-[13px] text-muted-foreground">None yet</span> : null}
          </Chips>
        </div>
      ) : null}
    </li>
  );
}

export function SkillsStep({ sheet, editable }: { sheet: SkillSheet; editable: boolean }) {
  const { people, types } = sheet;
  return (
    <>
      <Section title="Interview types" count={types.length || undefined}>
        {types.length ? (
          <ul className="m-0 grid list-none p-0">
            {types.map((t) => (
              <TypeRow key={`${t.id}:${t.name}`} type={t} editable={editable} />
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[13px] text-muted-foreground">{editable ? "Add an interview type to say who runs it." : "No interview types yet."}</p>
        )}
        {editable ? <AddType first={!types.length} /> : null}
      </Section>
      <Section title="Say what each person interviews for">
        <p className="m-0 text-[13px] text-muted-foreground">
          {editable ? "Tap an interview type if they run it, and star it to ask them first." : "What each person knows, and the interview types they run. A star means ask them first."}
        </p>
        <ul className="m-0 grid list-none p-0">
          {people.map((p) => (
            <PersonCard key={p.id} person={p} types={types} editable={editable} />
          ))}
        </ul>
      </Section>
    </>
  );
}
