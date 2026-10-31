// The reader's buttons (design/tats's `.kb-bar`), for the client bars and the
// server's Done reader alike: a plain file, because a server component gets no
// values out of a `"use client"` one.

export const button = "inline-flex h-7 items-center gap-2 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors";
export const primary = "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-106 disabled:opacity-60";
export const plain = "border-[color:var(--line-strong)] text-foreground hover:bg-[color:var(--hover)]";
