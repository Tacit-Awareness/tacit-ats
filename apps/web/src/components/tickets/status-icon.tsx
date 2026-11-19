// design/tacit-tickets/src/ui.tsx's StatusIcon: Linear's status ring, the pie
// filling as a step gets closer to done, with its meaning on hover. Server-safe.

export type Status = "needs" | "failed" | "waiting" | "running" | "done" | "cancelled";

const STATUS_COLOR: Record<Status, string> = {
  needs: "var(--amber)",
  failed: "var(--red)",
  waiting: "var(--blue)",
  running: "var(--green)",
  done: "var(--s-done, var(--faint))",
  cancelled: "var(--closed)",
};
const PIE: Partial<Record<Status, number>> = { running: 0.25, waiting: 0.5, needs: 0.75 };
const STATUS_MEANS: Record<Status, string> = {
  needs: "Needs you",
  failed: "Failed, needs a look",
  waiting: "Waiting on someone else",
  running: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export function StatusIcon({ status, size = 14, label }: { status: Status; size?: number; label?: string }) {
  const c = STATUS_COLOR[status];
  const frac = PIE[status];
  const says = label ?? STATUS_MEANS[status];
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0" role="img" aria-label={says}>
      <title>{says}</title>
      {status === "failed" ? (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke={c} strokeWidth="1.5" />
          <path d="M7 3.8v3.6" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7" cy="9.9" r="0.9" fill={c} />
        </>
      ) : frac !== undefined ? (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke={c} strokeWidth="1.5" />
          <circle cx="7" cy="7" r="2" fill="none" stroke={c} strokeWidth="4" strokeDasharray={`${frac * 12.566} 12.566`} transform="rotate(-90 7 7)" />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r="6.75" fill={c} />
          {status === "done" ? (
            <path d="M4.3 7.2 6.2 9 9.8 5.2" fill="none" stroke="var(--paper)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M4.9 4.9 9.1 9.1M9.1 4.9 4.9 9.1" stroke="var(--paper)" strokeWidth="1.6" strokeLinecap="round" />
          )}
        </>
      )}
    </svg>
  );
}
