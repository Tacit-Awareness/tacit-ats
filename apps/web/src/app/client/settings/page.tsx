import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { removeSubmitterAction, setJobOpenToTacitAction, setTacitModeAction } from "./actions";
import { SETTINGS_ERRORS, SETTINGS_NOTICES, isSettingsError, isSettingsNotice } from "./messages";

// Tacit's access to this org, for its admins: which jobs Tacit may submit
// candidates to (orgs.tacit_submissions, roles.open_to_tacit) and who from
// Tacit has (client_tacit_submitters). Read and written on the member's own
// token; a non-admin is told it is an admin's page, and the database refuses
// their writes regardless.

const MODES = [
  { value: "open_jobs", label: "All open jobs", hint: "Tacit can submit to any open job that isn't confidential." },
  { value: "chosen_jobs", label: "Only jobs I choose", hint: "Tacit can submit only to the jobs you turn on below." },
  { value: "off", label: "Off", hint: "Tacit can't submit candidates to you." },
] as const;

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function ClientSettings({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { notice, error } = await searchParams;
  const { db, accessLevel } = gate.ctx;

  if (accessLevel !== "admin") {
    return (
      <main className="glass mx-auto mt-[8vh] max-w-lg px-8 py-9">
        <h1 className="text-[28px] leading-[1.15] tracking-[-0.01em]">For admins</h1>
        <p className="mt-3 text-[15.5px] leading-[1.6] text-muted-foreground">
          Only your company&apos;s admins choose what Tacit can do here.
        </p>
      </main>
    );
  }

  const [org, jobs, submitters] = await Promise.all([
    db.from("orgs").select("tacit_submissions").maybeSingle(),
    db.from("roles").select("id, title, location, open_to_tacit").eq("status", "open").eq("confidential", false).order("title"),
    db.rpc("client_tacit_submitters"),
  ]);
  if (org.error) throw new Error(org.error.message);
  if (jobs.error) throw new Error(jobs.error.message);
  if (submitters.error) throw new Error(submitters.error.message);
  const mode = org.data?.tacit_submissions ?? "open_jobs";
  const people = submitters.data ?? [];

  return (
    <main className="max-w-3xl space-y-11">
      <div>
        <Link href="/client" className="text-[14px] text-muted-foreground transition-colors hover:text-foreground">
          ← Home
        </Link>
        <h1 className="mt-3 text-[34px] leading-[1.12] tracking-[-0.01em]">Tacit&apos;s access</h1>
        <p className="mt-2 text-[15.5px] text-muted-foreground">
          Tacit can submit candidates into your jobs, like a recruiting agency. They arrive in the job&apos;s pipeline
          marked as from Tacit, with the teammate who sent them and their note.
        </p>
      </div>

      {isSettingsNotice(notice) ? <p className="notice">{SETTINGS_NOTICES[notice]}</p> : null}
      {isSettingsError(error) ? <p className="notice notice-error">{SETTINGS_ERRORS[error]}</p> : null}

      <section className="space-y-3">
        <h2 className="text-[21px] leading-[1.3]">Which jobs</h2>
        <form action={setTacitModeAction} className="glass space-y-3 p-5">
          {MODES.map((m) => (
            <label key={m.value} className="flex items-start gap-3 text-[15px]">
              <input type="radio" name="mode" value={m.value} defaultChecked={mode === m.value} className="mt-1 size-4" />
              <span>
                <span className="font-medium">{m.label}</span>
                <span className="block text-sm text-muted-foreground">{m.hint}</span>
              </span>
            </label>
          ))}
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </form>
      </section>

      {mode === "chosen_jobs" ? (
        <section className="space-y-3">
          <h2 className="text-[21px] leading-[1.3]">Jobs open to Tacit</h2>
          {jobs.data.length === 0 ? (
            <p className="glass px-5 py-4 text-[15px] text-muted-foreground">You have no open jobs.</p>
          ) : (
            <ul className="glass divide-y divide-border overflow-hidden">
              {jobs.data.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <span>
                    <span className="text-[15px] font-medium">{j.title}</span>
                    {j.location ? <span className="block text-sm text-muted-foreground">{j.location}</span> : null}
                  </span>
                  <form action={setJobOpenToTacitAction} className="flex items-center gap-2">
                    <input type="hidden" name="roleId" value={j.id} />
                    <input type="hidden" name="open" value={j.open_to_tacit ? "false" : "true"} />
                    {j.open_to_tacit ? <Badge>Open to Tacit</Badge> : null}
                    <button
                      type="submit"
                      className="rounded-full px-2 py-1 text-[13px] text-primary transition-colors hover:bg-[rgb(29_111_165/0.07)]"
                    >
                      {j.open_to_tacit ? "Close to Tacit" : "Open to Tacit"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-[21px] leading-[1.3]">Who from Tacit has submitted</h2>
        {people.length === 0 ? (
          <p className="glass px-5 py-4 text-[15px] text-muted-foreground">Nobody from Tacit has submitted a candidate yet.</p>
        ) : (
          <ul className="glass divide-y divide-border overflow-hidden">
            {people.map((s) => (
              <li key={s.actor_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <span>
                  <span className="text-[15px] font-medium">{s.display_name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {s.email} · {s.submissions} candidate{Number(s.submissions) === 1 ? "" : "s"} since {when(s.first_at)}
                  </span>
                </span>
                {s.removed_at ? (
                  <span className="text-[13px] text-muted-foreground">Removed {when(s.removed_at)}</span>
                ) : (
                  <form action={removeSubmitterAction}>
                    <input type="hidden" name="actorId" value={s.actor_id} />
                    <button
                      type="submit"
                      className="rounded-full px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-negative-soft hover:text-negative"
                    >
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
