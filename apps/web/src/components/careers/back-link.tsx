"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { leaveRole, plainClick } from "./motion";

// "All roles" on a role's page: the sheet fades down and away before the board
// draws, and the board fades in (roles.tsx). A plain link without script.

export function BackLink({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Link
      className={className}
      href={href}
      onClick={async (e) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        await leaveRole(e.currentTarget.closest(".careers")?.querySelector("main") ?? null);
        router.push(href);
      }}
    >
      {children}
    </Link>
  );
}
