// Shown the moment a member navigates inside /client while the page's
// server render still runs (the whole area is force-dynamic): the frame
// swaps instantly and the real content streams in, instead of a second
// of dead air. Pulse blocks, not a spinner, so the page feels faster.
export default function ClientLoading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse px-6 py-8" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-44 rounded-md bg-muted/60" />
      <div className="mt-2 h-4 w-72 rounded-md bg-muted/40" />
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl border border-border bg-muted/30" />
        ))}
      </div>
      <div className="mt-6 space-y-2.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 rounded-xl border border-border bg-muted/30" />
        ))}
      </div>
    </div>
  );
}
