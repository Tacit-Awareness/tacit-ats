// Shown the moment a member navigates inside /client while the page's
// server render still runs (the whole area is force-dynamic): the frame
// swaps instantly and the real content streams in, instead of a second
// of dead air. A page's shape in quiet blocks, not a spinner, so the page
// feels faster: the title on the box's surface, then soft white cards, as
// every page is drawn (components/page.tsx). The blocks only pulse when
// motion is welcome.
const block = "rounded-[6px] bg-[color:var(--soft-strong)]";

export default function ClientLoading() {
  return (
    <div className="grid gap-5 motion-safe:animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="flex h-[30px] items-center">
        <div className={`h-6 w-44 ${block}`} />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid h-[104px] content-start gap-4 rounded-[14px] bg-card px-5 pt-5 shadow-[var(--shadow)]">
            <div className={`h-3 w-24 ${block}`} />
            <div className={`h-7 w-16 ${block}`} />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-[14px] bg-card shadow-[var(--shadow)]">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex h-14 items-center gap-3 border-t border-[color:var(--line)] px-5 first:border-t-0">
            <div className="size-3.5 rounded-[4px] bg-[color:var(--soft-strong)]" />
            <div className={`h-3 ${i % 2 ? "w-40" : "w-56"} ${block}`} />
            <div className="flex-1" />
            <div className={`h-3 w-12 ${block}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
