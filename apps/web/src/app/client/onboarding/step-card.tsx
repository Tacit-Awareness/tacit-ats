// design/tats-ui-update's `.su-card` and its `.su-ch` head: a step's own card,
// inside the frame's soft border (frame.tsx). The heading is 18px over a line
// that says what the step is for, with the step's action beside it.

export function StepCard({ title, sub, aside, children }: { title: React.ReactNode; sub?: React.ReactNode; aside?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="grid min-w-0 content-start gap-5 rounded-[13px] bg-[color:var(--raised)] p-4 text-[13px] shadow-[var(--shadow)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid min-w-0 max-w-[520px] gap-2">
          <h3 className="m-0 text-lg font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">{title}</h3>
          {sub ? <p className="m-0 text-sm leading-normal text-muted-foreground">{sub}</p> : null}
        </div>
        {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

