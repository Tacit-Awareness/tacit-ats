import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Tacit" };
export const dynamic = "force-dynamic";

// The client area's shell. Nothing here reads the database: the page decides
// who the user is (lib/client/session.ts) and what they may see.
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-white/72 backdrop-blur-[22px] backdrop-saturate-[1.7]">
        <div className="mx-auto flex h-[72px] w-full max-w-[1320px] items-center justify-between px-6 sm:px-9">
          <Link href="/client" aria-label="Tacit" className="-m-1 rounded-md p-1">
            <span className="tacit-mark aspect-[900/620] w-10" />
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href="/client/integrations" className="rounded-full px-2 py-1 text-[14px] text-muted-foreground transition-colors hover:text-foreground">
              Integrations
            </Link>
            <Link href="/client/docs" className="rounded-full px-2 py-1 text-[14px] text-muted-foreground transition-colors hover:text-foreground">
              Documentation
            </Link>
            <form action="/client/signout" method="post">
              <button
                type="submit"
                className="rounded-full bg-card px-3 py-1.5 text-[13px] font-medium text-[#27272a] shadow-[var(--bubble)] transition-shadow duration-150 hover:shadow-[var(--bubble-hover)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="tb-enter mx-auto w-full max-w-[1320px] flex-1 px-6 pt-11 pb-16 sm:px-9">{children}</div>
    </div>
  );
}
