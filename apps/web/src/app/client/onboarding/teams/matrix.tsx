"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Avatar, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyTeamChange, isMultidisciplinary, teamsOf, type MatrixPerson, type MatrixTeam, type TeamChange, type TeamMatrix } from "@/lib/client/team-matrix";
import { showToast } from "@/lib/toasts";
import { cn } from "@/lib/utils";
import { createTeamAction, setTeamLeadAction, setTeamMemberAction } from "./actions";

// design/tats's `#setup~teams`: people down the side, teams across the top, each
// tick saved at once. It shows the change straight away and takes it back on a
// refusal, which a toast explains. Below `md` a matrix cannot fit, so it is a list
// per person with their teams under them; the matrix scrolls inside its own box
// when a company has more teams than the column holds, never the page.

type Save = (change: TeamChange) => void;

const DROPPED = "The connection dropped, so this may not have saved. Reload and check.";
const NEW_TEAM_NOTICES = { created: "Team added.", exists: "That team was already here.", restored: "That team was archived, so it's back, with who was on it." };

function Multidisciplinary() {
  return <em className="text-xs font-medium whitespace-nowrap text-[color:var(--accent)] not-italic">Multidisciplinary</em>;
}

function Tick({ on, label, onClick }: { on: boolean; label: string; onClick?: () => void }) {
  const box = cn("grid size-4 shrink-0 place-items-center rounded-[4px] text-[color:var(--n0)]", on ? "bg-[color:var(--accent)]" : "shadow-[inset_0_0_0_1.25px_var(--line-strong)]");
  const mark = on ? (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-2.5" aria-hidden>
      <path d="M2.5 6.2 5 8.6l4.5-5" />
    </svg>
  ) : null;
  if (!onClick) {
    return (
      <span role="img" aria-label={`${label}: ${on ? "yes" : "no"}`} className={box}>
        {mark}
      </span>
    );
  }
  return (
    <button type="button" aria-label={label} aria-pressed={on} onClick={onClick} className="-m-1.5 grid size-7 shrink-0 place-items-center">
      <span className={box}>{mark}</span>
    </button>
  );
}

function Lead({ lead, person, team, onClick }: { lead: boolean; person: string; team: string; onClick?: () => void }) {
  const look = cn("text-xs", lead ? "font-medium text-foreground" : "text-faint");
  if (!onClick) return lead ? <span className={look}>Lead</span> : null;
  return (
    <button
      type="button"
      aria-label={lead ? `${person} leads ${team}. Clear the lead` : `Make ${person} lead of ${team}`}
      aria-pressed={lead}
      onClick={onClick}
      className={cn(look, "px-1 py-0.5 hover:text-foreground")}
    >
      Lead
    </button>
  );
}

function Place({ person, team, save }: { person: MatrixPerson; team: MatrixTeam; save?: Save }) {
  const on = team.members.includes(person.id);
  const lead = team.lead === person.id;
  return (
    <>
      <Tick on={on} label={`${person.name} on ${team.path}`} onClick={save && (() => save({ kind: "member", teamId: team.id, memberId: person.id, on: !on }))} />
      {/* Holds its place, so the ticks stay in line whether or not this one has a Lead. */}
      <span className="w-9 shrink-0">{on ? <Lead lead={lead} person={person.name} team={team.path} onClick={save && (() => save({ kind: "lead", teamId: team.id, memberId: lead ? null : person.id }))} /> : null}</span>
    </>
  );
}

function Who({ matrix, person }: { matrix: TeamMatrix; person: MatrixPerson }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-[13px]">
      <Avatar name={person.name} />
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <b className="min-w-0 font-medium [overflow-wrap:anywhere]">{person.name}</b>
        {isMultidisciplinary(matrix, person.id) ? <Multidisciplinary /> : null}
      </span>
    </span>
  );
}

function Grid({ matrix, save }: { matrix: TeamMatrix; save?: Save }) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[color:var(--line)] text-muted-foreground">
            <th scope="col" className="sticky left-0 min-w-[200px] bg-[color:var(--paper)] py-2 pr-3 text-left font-normal">
              <span className="sr-only">Person</span>
            </th>
            {matrix.teams.map((t) => (
              <th key={t.id} scope="col" className="min-w-[104px] px-2 py-2 text-left align-bottom font-normal">
                <span className="[overflow-wrap:anywhere]">{t.path}</span> <span className="text-faint tabular-nums">{t.members.length}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.people.map((p) => (
            <tr key={p.id} className="border-b border-[color:var(--line)] last:border-b-0">
              <th scope="row" className="sticky left-0 bg-[color:var(--paper)] py-2 pr-3 text-left font-normal">
                <Who matrix={matrix} person={p} />
              </th>
              {matrix.teams.map((t) => (
                <td key={t.id} className="px-2 py-2">
                  <span className="flex h-7 items-center gap-2">
                    <Place person={p} team={t} save={save} />
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonList({ matrix, save }: { matrix: TeamMatrix; save?: Save }) {
  return (
    <ul className="m-0 grid list-none gap-0 p-0 md:hidden">
      {matrix.people.map((p) => (
        <li key={p.id} className="grid min-w-0 gap-1.5 border-b border-[color:var(--line)] py-3 last:border-b-0">
          <Who matrix={matrix} person={p} />
          {/* A reader who cannot change anything needs only the teams they are on. */}
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {(save ? matrix.teams : teamsOf(matrix, p.id)).map((t) => (
              <li key={t.id} className="flex min-h-8 min-w-0 items-center gap-2.5 text-[13px]">
                <span className="min-w-0 flex-1 text-muted-foreground [overflow-wrap:anywhere]">{t.path}</span>
                <Place person={p} team={t} save={save} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function NewTeam({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex min-w-0 flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          try {
            const answer = await createTeamAction({ name });
            if (answer.ok) {
              showToast({ text: NEW_TEAM_NOTICES[answer.outcome] });
              onClose();
            } else {
              showToast({ text: answer.error, tone: "error" });
            }
          } catch {
            showToast({ text: DROPPED, tone: "error" });
          }
        });
      }}
    >
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Team name" placeholder="Team name" autoComplete="off" className="w-[220px] max-w-full" />
      <Button type="submit" size="sm" disabled={pending || !name.trim()}>
        {pending ? "Adding…" : "Add team"}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onClose}>
        Cancel
      </Button>
    </form>
  );
}

export function TeamsStep({ matrix, editable }: { matrix: TeamMatrix; editable: boolean }) {
  const [shown, show] = useOptimistic(matrix, applyTeamChange);
  const [, start] = useTransition();
  const [adding, setAdding] = useState(false);

  const save: Save = (change) =>
    start(async () => {
      show(change);
      try {
        const answer = await (change.kind === "lead" ? setTeamLeadAction({ teamId: change.teamId, memberId: change.memberId }) : setTeamMemberAction({ teamId: change.teamId, memberId: change.memberId, on: change.on }));
        if (!answer.ok) showToast({ text: answer.error, tone: "error" });
      } catch {
        showToast({ text: DROPPED, tone: "error" });
      }
    });

  const empty = !shown.teams.length;
  const writer = editable ? save : undefined;
  return (
    <Section
      title="Put people on teams"
      aside={
        editable && !adding && !empty ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            New team
          </Button>
        ) : null
      }
    >
      <p className="m-0 text-[13px] text-muted-foreground">Put someone on more than one team when they can interview across both.</p>
      {adding ? <NewTeam onClose={() => setAdding(false)} /> : null}
      {empty ? (
        <div className="grid justify-items-start gap-2 py-3">
          <p className="m-0 text-[13px] text-muted-foreground">{editable ? "No teams yet. Add the first one." : "No teams yet."}</p>
          {editable && !adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              New team
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <Grid matrix={shown} save={writer} />
          <PersonList matrix={shown} save={writer} />
        </>
      )}
    </Section>
  );
}
