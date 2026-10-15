import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Tacit" };
export const dynamic = "force-dynamic";

// The client area's shell. Nothing here reads the database: the page decides
// who the user is (lib/client/session.ts) and what they may see.
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-1 flex-col px-6 py-8">
      <header className="mb-10 flex items-center justify-between">
        <span className="tacit-mark aspect-[900/620] w-12" aria-label="Tacit" />
        <div className="flex items-center gap-5">
          <Link href="/client/docs" className="text-sm text-muted-foreground hover:text-foreground">
            Use with Claude
          </Link>
          <form action="/client/signout" method="post">
            <button type="submit" className="text-sm text-muted-foreground hover:text-foreground">
              Sign out
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
