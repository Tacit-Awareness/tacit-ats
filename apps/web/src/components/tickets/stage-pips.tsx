// design/tacit-tickets/src/ui.tsx's StagePips: the application's place among the
// live stages as pips, the stage named beside them. Server-safe.

const STAGES = [
  { key: "sourced", label: "Sourced" },
  { key: "contacted", label: "Contacted" },
  { key: "screening", label: "Screening" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offer", label: "Offer" },
];

export function StagePips({ stage }: { stage: string }) {
  const at = STAGES.findIndex((s) => s.key === stage);
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="inline-flex gap-[3px]" aria-hidden="true">
        {STAGES.map((s, i) => (
          <span key={s.key} className="h-2.5 w-1 rounded-full" style={{ background: i <= at ? "var(--faint)" : "var(--line-strong)" }} />
        ))}
      </span>
      <span className="text-body">{STAGES[at]?.label ?? stage}</span>
    </span>
  );
}
