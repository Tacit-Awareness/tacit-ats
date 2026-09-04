// server-only's exports map sends the `default` condition to a file that is a
// bare `throw` — only the `react-server` condition gets the no-op. Vitest
// resolves with ['module','node',...], never react-server, so importing any
// server-only module under test throws at import time. Aliasing to this empty
// stub is the fix. Setting resolve.conditions: ["react-server"] would also
// work but changes React's own resolution repo-wide, which is not worth it.
export {};
