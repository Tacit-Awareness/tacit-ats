"use client";

import { useState } from "react";
import { Row, Rows, Section } from "@/components/page";
import { cn } from "@/lib/utils";

// design/tats's Routing Rules: how a Grokbot picks an interviewer, and when a
// run comes back to you. Front end only: there is no backend yet, so nothing
// picks by these, the switches are not saved, and the page says so.

const SELECTION = [
  { key: "want", name: "Wants to interview", detail: "Based on their past replies to interview requests" },
  { key: "room", name: "Has room this week", detail: "Weekly limit minus interviews already booked" },
  { key: "match", name: "Knows the area", detail: "Focus areas matched to the role" },
  { key: "fair", name: "Spreads the load", detail: "Rotates first rounds across the team" },
];

const ESCALATION = [
  { name: "No reply in 24 hours", detail: "One automatic reminder, then it comes to your Inbox" },
  { name: "A tool fails", detail: "Gmail, Slack or Calendar access lost. The run stops and comes to your Inbox with the fix" },
  { name: "Nobody on the team can take it", detail: "Returned to your Inbox" },
];

/** design/tats's `.switch`: 30 by 18, the accent when on. */
function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]",
        on ? "bg-[color:var(--accent)]" : "bg-[color:var(--soft-strong)]",
      )}
    >
      <i className={cn("absolute top-0.5 left-0.5 size-3.5 rounded-full bg-[color:var(--n0)] shadow-[var(--shadow)] transition-transform", on && "translate-x-3")} />
    </button>
  );
}

export function RoutingRules() {
  const [off, setOff] = useState<string[]>([]);
  const toggle = (key: string) => setOff((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

  return (
    <>
      <div className="mt-2 grid gap-0.5">
        <h2 className="m-0 text-[17px] font-semibold">Routing Rules</h2>
        <p className="m-0 text-[13px] text-muted-foreground">A preview: these don&apos;t change who gets asked yet, and the switches aren&apos;t saved.</p>
      </div>
      <Section flush title="Interviewer selection">
        <Rows ruled>
          {SELECTION.map((rule) => (
            <Row
              key={rule.key}
              title={rule.name}
              sub={rule.detail}
              meta={<Switch on={!off.includes(rule.key)} label={rule.name} onToggle={() => toggle(rule.key)} />}
            />
          ))}
        </Rows>
      </Section>
      <Section flush title="Escalation">
        <Rows ruled>
          {ESCALATION.map((rule) => (
            <Row key={rule.name} title={rule.name} sub={rule.detail} />
          ))}
        </Rows>
      </Section>
    </>
  );
}
