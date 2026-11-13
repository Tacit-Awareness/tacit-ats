import Link from "next/link";
import { pillOption, pillTrack } from "@/components/page";

/**
 * The Interviewers page's two views, beside its title: People (who interviews,
 * how booked they are, their feedback) and Agents (what each person's agent is
 * doing, and whose agent it is waiting on). Links, so each view has its own
 * address and the back button moves between them.
 */
export function InterviewersViewSwitch({ current }: { current: "people" | "agents" }) {
  const views = [
    { key: "people", label: "People", href: "/client/interviewers" },
    { key: "agents", label: "Agents", href: "/client/interviewers/agents" },
  ] as const;
  return (
    <nav aria-label="View" className={pillTrack}>
      {views.map((v) => (
        <Link key={v.key} href={v.href} aria-current={v.key === current ? "page" : undefined} className={pillOption(v.key === current, "sm")}>
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
