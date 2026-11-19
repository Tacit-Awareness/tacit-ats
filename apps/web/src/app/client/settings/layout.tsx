import { SettingsNav } from "./nav";

// Settings' frame (design/tacit-tickets's Settings): the sections on the left,
// the one open beside them. The pages under it read and write as they did.

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="list-reader flex min-h-0 min-w-0 flex-1">
      <SettingsNav />
      <div className="scroll-quiet min-w-0 flex-1 overflow-y-auto px-[var(--page-gutter)] py-7">{children}</div>
    </div>
  );
}
