// A step's own card, as Testbench's Assessment Creator draws one step: white,
// 14px, a soft shadow, the heading in Mona Sans with the step's action beside it.
// What the step is for is the heading's hover title, not a grey line under it.

export function StepCard({ title, sub, aside, children }: { title: React.ReactNode; sub?: string; aside?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="grid min-w-0 content-start gap-5 rounded-[14px] bg-card px-5 pt-5 pb-6 text-[13px] shadow-[var(--shadow)] sm:px-7 sm:pt-6 sm:pb-7">
      <div className="flex min-h-[30px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 title={sub} className="m-0 flex min-w-0 items-center gap-2 font-sans text-[18px] leading-6 font-semibold tracking-[-0.015em] [overflow-wrap:anywhere]">
          {title}
        </h2>
        {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}
