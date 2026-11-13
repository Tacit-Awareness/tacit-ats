// ⌘↵ inside a button's key, drawn rather than typed: Geist Mono has neither
// glyph, and the fallback font sets them small and off the line. Testbench
// draws a key's symbols the same way (`.btn kbd svg`, 11px). A plain file, so
// the server's Done reader and the client bars (and New Applicants' reply) share it.

const icon = "size-[11px]! flex-none";

export function CmdEnter() {
  return (
    <span aria-hidden className="inline-flex items-center gap-px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={icon}>
        <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
      </svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={icon}>
        <path d="M20 4v7a4 4 0 0 1-4 4H4" />
        <path d="m9 10-5 5 5 5" />
      </svg>
    </span>
  );
}
