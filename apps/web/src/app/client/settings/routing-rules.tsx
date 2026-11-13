"use client";

import { useState } from "react";
import { Pill, Section } from "@/components/page";
import { SetBand, SetRow } from "./rows";

// design/tats's Routing Rules: how a Grokbot picks an interviewer, and when a
// run comes back to you. Front end only: there is no backend yet, so nothing
// picks by these, the switches are not saved, and the Preview tag says so.
// One card, the two groups as bands inside it.

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

const PREVIEW = "A preview: these don't change who gets asked yet, and the switches aren't saved.";

/** Testbench's `.toggle` (settings.css): 32 by 18, ink when on. */
function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle} className="set-toggle" />;
}

export function RoutingRules() {
  const [off, setOff] = useState<string[]>([]);
  const toggle = (key: string) => setOff((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

  return (
    <Section
      flush
      aria-label="Routing rules"
      title={
        <>
          Routing rules
          <Pill title={PREVIEW}>
            Preview<span className="sr-only">. {PREVIEW}</span>
          </Pill>
        </>
      }
    >
      <SetBand>Interviewer selection</SetBand>
      {SELECTION.map((rule) => (
        <SetRow
          key={rule.key}
          name={rule.name}
          detail={rule.detail}
          action={<Switch on={!off.includes(rule.key)} label={rule.name} onToggle={() => toggle(rule.key)} />}
        />
      ))}
      <SetBand>Escalation</SetBand>
      {ESCALATION.map((rule) => (
        <SetRow key={rule.name} name={rule.name} detail={rule.detail} />
      ))}
    </Section>
  );
}
