"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Settings' sections (design/tacit-tickets's Settings nav): the company's setup,
// out of the way. Each opens where it is set: General, Integrations and
// Templates are Settings' own pages; Members, Interviewers, Rounds and Teams are
// Onboarding's and the Interviewers page, which already set them. The
// prototype's Labels, Fields, Approvals and Connector sections have no page in
// tATS's web app (the client connector sets them), so they are not here.

export const SECTIONS = [
  { label: "General", href: "/client/settings/general" },
  { label: "Members", href: "/client/onboarding/people" },
  { label: "Interviewers", href: "/client/interviewers" },
  { label: "Rounds", href: "/client/onboarding/process" },
  { label: "Teams", href: "/client/onboarding/teams" },
  { label: "Templates", href: "/client/settings/templates" },
  { label: "Integrations", href: "/client/settings" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="scroll-quiet flex w-[200px] shrink-0 flex-col gap-px overflow-y-auto border-r border-line p-2 max-md:hidden">
      <div className="flex h-9 items-center px-2.5 font-medium text-ink">Settings</div>
      {SECTIONS.map((x) => {
        const on = pathname === x.href;
        return (
          <Link key={x.href} href={x.href} aria-current={on ? "page" : undefined} className={`flex h-7 items-center rounded-md px-2.5 text-left transition-colors ${on ? "bg-sel text-ink" : "text-body hover:bg-hover"}`}>
            {x.label}
          </Link>
        );
      })}
    </nav>
  );
}
