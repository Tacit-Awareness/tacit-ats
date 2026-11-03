import Link from "next/link";
import { Avatar, textLink } from "@/components/page";
import type { Coverage, CoverageRow } from "@/lib/client/coverage";
import { cn } from "@/lib/utils";
import { StepCard } from "../step-card";

// Onboarding's Review step, props only (page.tsx reads): design/tats's "Ready for
// tATS", the totals and who runs each kind of interview. A gap is said in words
// beside its row and counted under the list; only an admin is pointed at the fix.

const SKILLS = "/client/onboarding/skills";

function Total({ n, label }: { n: string | number; label: string }) {
  return (
    <div className="grid gap-0.5 bg-[color:var(--paper)] px-3.5 py-3">
      <b className="text-[22px] leading-none font-medium tabular-nums">{n}</b>
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
    </div>
  );
}

function Row({ row }: { row: CoverageRow }) {
  const gap = !row.people.length;
  return (
    <li className="grid gap-x-4 gap-y-1.5 border-t border-[color:var(--line)] py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center">
      <span className="min-w-0 text-[13.5px] font-medium [overflow-wrap:anywhere]">{row.name}</span>
      {gap ? (
        <span className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--amber)]">
          <i aria-hidden className="size-1.5 flex-none rounded-full bg-current" />
          No one runs this yet
        </span>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1.5 p-0">
          {row.people.map((p) => (
            <li key={p.id} className="inline-flex min-w-0 items-center gap-1.5 text-[13px]" title={p.starred ? `${p.name}, prioritized` : p.name}>
              <Avatar name={p.name} size="xs" />
              <span className="min-w-0 truncate">{p.name}</span>
              {p.starred ? (
                <span className="text-[color:var(--accent)]">
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
      <p className="m-0 text-[13px] text-muted-foreground">
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
  if (coverage.state === "covered") return <p className="m-0 text-[13px] text-muted-foreground">Every interview type has someone who runs it.</p>;
  return null;
}

export function ReviewStep({ coverage, ready, canEdit, truncated }: { coverage: Coverage; /** Every other step is done. */ ready: boolean; canEdit: boolean; truncated: boolean }) {
  const n = coverage.gaps.length;
  return (
    <StepCard title={ready && coverage.state === "covered" ? "Ready for tATS" : "Review your setup"} sub="Here's who runs each kind of interview.">
      <div className={cn("grid grid-cols-2 gap-px border border-[color:var(--line)] bg-[color:var(--line)] sm:grid-cols-4")}>
        <Total n={coverage.interviewers} label={coverage.interviewers === 1 ? "interviewer" : "interviewers"} />
        <Total n={coverage.teams} label={coverage.teams === 1 ? "team" : "teams"} />
        <Total n={coverage.multidisciplinary} label="multidisciplinary" />
        <Total n={`${coverage.covered} of ${coverage.types}`} label="interview types covered" />
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
        <p className="m-0 text-[13px] text-muted-foreground">
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
