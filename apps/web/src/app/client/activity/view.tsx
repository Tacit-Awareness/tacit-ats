import Link from "next/link";
import { Notice, Page, PageBar } from "@/components/page";
import type { BotAttention, LogRow } from "@/lib/client/bot-activity";
import { BotCommandButton } from "./command-button";
import { BotLog } from "./log";

// Grokbot Activity's markup, props only (page.tsx does the reads): design/tats's
// #activity, one card: what needs you first, each with its one fix, then the
// log. Everything a bot or a member wrote renders as text.

export type TodoRow = {
  attention: BotAttention;
  /** Null when there is no candidate to open. */
  href: string | null;
  /** The member may press the fix: the same rule bot_task_command applies. */
  canAct: boolean;
};

function Todo({ row }: { row: TodoRow }) {
  const { attention: a } = row;
  const note = a.queued ?? a.missed;
  return (
    <li className="mx-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[10px] px-3 py-2.5 md:mx-3">
      <span className="grid min-w-0 gap-0.5">
        {row.href ? (
          <Link href={row.href} className="text-[14.5px] font-medium break-words hover:underline">
            {a.what}
          </Link>
        ) : (
          <b className="text-[14.5px] font-medium break-words">{a.what}</b>
        )}
        <span className="text-[13px] break-words text-muted-foreground">{a.why}</span>
        {note ? <span className="text-[12.5px] break-words text-faint">{note}</span> : null}
      </span>
      {row.canAct && !a.queued ? <BotCommandButton fix={a.fix} from="activity" /> : null}
    </li>
  );
}

export function ActivityView({
  todos,
  todosCapped,
  log,
  logCapped,
  logMax,
  now,
  notice,
  error,
}: {
  todos: TodoRow[];
  todosCapped: boolean;
  log: LogRow[];
  logCapped: boolean;
  logMax: number;
  now: number;
  notice: string | null;
  error: string | null;
}) {
  return (
    <Page bar={<PageBar title="Grokbot Activity" />}>
      {error ? <Notice tone="error">{error}</Notice> : notice ? <Notice>{notice}</Notice> : null}
      <div data-tour="activity" className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--paper)]">
        <section aria-label="Needs you" className="pb-2">
          <h2 className="m-0 flex items-center gap-2.5 px-4 pt-5 pb-2.5 text-[15px] font-semibold md:px-6">
            Needs you
            {todos.length ? <span className="text-[14px] font-normal text-faint tabular-nums">{todos.length}</span> : null}
          </h2>
          {todos.length ? (
            <ul className="m-0 list-none p-0">
              {todos.map((t) => (
                <Todo key={t.attention.taskId} row={t} />
              ))}
            </ul>
          ) : (
            <p className="m-0 flex items-center gap-2 px-4 pb-2.5 text-[14px] text-muted-foreground md:px-6">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-[15px] text-[color:var(--green)]" aria-hidden>
                <path d="m3.5 8.5 3 3 6-7" />
              </svg>
              Nothing needs you.
            </p>
          )}
          {todosCapped ? <p className="m-0 px-4 pt-1 text-[12.5px] text-faint md:px-6">Too many tasks to check them all, so older ones may not be listed.</p> : null}
        </section>
        <BotLog rows={log} capped={logCapped} max={logMax} now={now} />
      </div>
    </Page>
  );
}
