import type { StepLine } from "@/lib/client/bot-activity";

// A task's steps as its bot reported them, oldest first. They are the bot's
// own opaque labels, never message text, and they render as text.

export function BotSteps({ steps }: { steps: StepLine[] }) {
  return (
    <ol className="m-0 grid list-none gap-1 p-0 text-[13px]">
      {steps.map((s, i) => (
        <li key={i} className="flex min-w-0 items-baseline gap-3">
          <span className="min-w-0 flex-1 break-words">{s.label}</span>
          {s.age ? <span className="flex-none text-[12.5px] text-faint tabular-nums">{s.age}</span> : null}
        </li>
      ))}
    </ol>
  );
}
