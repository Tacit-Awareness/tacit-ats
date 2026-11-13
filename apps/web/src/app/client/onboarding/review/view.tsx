import Link from "next/link";
import { Pill, textLink } from "@/components/page";
import type { Coverage, CoverageRow } from "@/lib/client/coverage";
import { StepCard } from "../step-card";

// Onboarding's Review step, props only (page.tsx reads): design/tats's "Ready for
// tATS", the totals as Testbench's stats (a small label over a big Geist Mono
// number) and who runs each kind of interview, by name. A gap is an amber tag
// beside its row and counted under the list; only an admin is pointed at the fix.

const SKILLS = "/client/onboarding/skills";

function Total({ n, label }: { n: string | number; label: string }) {
  return (
    // The number sits at the foot, so a label that wraps does not push one number lower than the rest.
    <div className="flex min-w-0 flex-col justify-between gap-3 px-4 pt-3.5 pb-4 shadow-[1px_0_0_var(--line),0_1px_0_var(--line)]">
      <span className="text-[12.5px] text-faint">{label}</span>
      <b className="font-mono text-[30px] leading-none font-normal tracking-[-0.03em] tabular-nums">{n}</b>
    </div>
  );
}

function Row({ row }: { row: CoverageRow }) {
  const gap = !row.people.length;
  return (
    <li className="grid min-h-12 gap-x-4 gap-y-1.5 border-t border-[color:var(--line)] py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center">
      <span className="min-w-0 text-[13px] font-medium [overflow-wrap:anywhere]">{row.name}</span>
      {gap ? (
        <span>
          <Pill tone="amber">No one runs this yet</Pill>
        </span>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0">
          {row.people.map((p) => (
            <li key={p.id} className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground" title={p.starred ? `${p.name}, prioritized` : p.name}>
              <span className="min-w-0 truncate">{p.name}</span>
              {p.starred ? (
                <span className="text-foreground">
                  <span aria-hidden>★</span>
                  <span className="sr-only">, prioritized</span>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Lead({ coverage, canEdit }: { coverage: Coverage; canEdit: boolean }) {
  if (coverage.state === "no_types") {
    return (
      <p className="m-0 text-[13px] text-faint">
        No interview types yet.{" "}
        {canEdit ? (
          <Link href={SKILLS} className={textLink}>
            Add them in Interview skills
          </Link>
        ) : (
          "An admin adds them in Interview skills."
        )}
      </p>
    );
  }
  if (coverage.state === "covered") return <p className="m-0 text-[13px] text-faint">Every interview type has someone who runs it.</p>;
  return null;
}

export function ReviewStep({ coverage, ready, canEdit, truncated }: { coverage: Coverage; /** Every other step is done. */ ready: boolean; canEdit: boolean; truncated: boolean }) {
  const n = coverage.gaps.length;
  return (
    <StepCard title={ready && coverage.state === "covered" ? "Ready for tATS" : "Review your setup"} sub="Here's who runs each kind of interview.">
      {/* A recessed well, its cells ruled by their own right and bottom edges, which the clip hides at the rim. */}
      <div className="grid grid-cols-2 overflow-hidden rounded-[10px] bg-[color:var(--soft)] shadow-[inset_0_0_0_1px_var(--line)] sm:grid-cols-4">
        <Total n={coverage.interviewers} label={coverage.interviewers === 1 ? "Interviewer" : "Interviewers"} />
        <Total n={coverage.teams} label={coverage.teams === 1 ? "Team" : "Teams"} />
        <Total n={coverage.multidisciplinary} label="Multidisciplinary" />
        <Total n={`${coverage.covered} of ${coverage.types}`} label="Interview types covered" />
      </div>
      <Lead coverage={coverage} canEdit={canEdit} />
      {coverage.rows.length ? (
        <ul aria-label="Interview types" className="m-0 grid list-none p-0">
          {coverage.rows.map((r) => (
            <Row key={r.typeId} row={r} />
          ))}
        </ul>
      ) : null}
      {n ? (
        <p className="m-0 text-[13px] text-faint">
          {n} interview {n === 1 ? "type has" : "types have"} no interviewer.{" "}
          {canEdit ? (
            <Link href={SKILLS} className={textLink}>
              Say who runs {n === 1 ? "it" : "them"}
            </Link>
          ) : null}
        </p>
      ) : null}
      {truncated ? <p className="m-0 text-xs text-faint">This stopped short of your whole team.</p> : null}
    </StepCard>
  );
}
