import Link from "next/link";
import { Pill } from "@/components/page";
import { cn } from "@/lib/utils";
import "./settings.css";

// The rows Settings is made of, Testbench's `.ws-row` (settings.css): 56px,
// the name over a quiet line on the left, the control on the right. A row
// that goes somewhere is a link with a hover and a chevron. Server-safe, so
// the client sections (routing-rules.tsx, integrations/bot.tsx) use them too.

export function SetRow({
  id,
  href,
  icon,
  name,
  detail,
  action,
  hint,
  className,
}: {
  id?: string;
  /** The row goes to the page where this is set. */
  href?: string;
  /** A logo or a line icon, bare: Testbench boxes no icons. */
  icon?: React.ReactNode;
  name: React.ReactNode;
  detail?: React.ReactNode;
  action?: React.ReactNode;
  /** What the row is for: on hover, and read out after the name. */
  hint?: string;
  className?: string;
}) {
  const body = (
    <>
      {icon ? <span className="grid w-5 flex-none place-items-center">{icon}</span> : null}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <b className="min-w-0 font-medium break-words text-foreground">{name}</b>
        {detail ? <span className="min-w-0 text-[12px] leading-[18px] break-words text-faint">{detail}</span> : null}
        {/* the hover's words, for a screen reader too */}
        {hint ? <span className="sr-only">{hint}</span> : null}
      </span>
      {action ? <span className="set-action flex flex-none flex-wrap items-center justify-end gap-1.5">{action}</span> : null}
      {href ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="size-4 flex-none text-[color:var(--ink-4)]" aria-hidden>
          <path d="M6 3.5l4.5 4.5L6 12.5" />
        </svg>
      ) : null}
    </>
  );
  const cls = cn("set-row scroll-mt-4", className);
  return href ? (
    <Link id={id} href={href} title={hint} className={cls}>
      {body}
    </Link>
  ) : (
    <div id={id} title={hint} className={cls}>
      {body}
    </div>
  );
}

/** A group's name inside a card, in a 40px band. */
export function SetBand({ children }: { children: React.ReactNode }) {
  return <h3 className="set-band">{children}</h3>;
}

/** Testbench's green tag with its check, for a connected tool. */
export function ConnectedTag({ children = "Connected" }: { children?: React.ReactNode }) {
  return (
    <Pill tone="green">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-[13px]" aria-hidden>
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
      {children}
    </Pill>
  );
}
