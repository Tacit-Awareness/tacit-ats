import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { KeyList } from "@/components/keys";
import { ListReader, textLink } from "@/components/page";
import { cn } from "@/lib/utils";
import { ActivityStory } from "../candidates/activity-story";
import { button, plain } from "./buttons";
import { MoveBackButton } from "./set-aside";
import { DoneBar, Row, type IssueRow } from "./view";

// Done's markup, props only: design/tats's Done list and reader, a flat list
// newest first, and the same reader with a line saying how it left. Reached from
// the Inbox card's footer, and its bar goes back there. Nothing here acts on the
// issue but moving it back. Its fix and an offer's terms stay in the Inbox, while
// it is still there to be dealt with.

export type DoneReaderProps = {
  id: string;
  what: string;
  subject: string;
  how: string;
  /** Null while the issue is as it was: it is in the queue, or Move back is there. */
  since: string | null;
  canMoveBack: boolean;
  candidateHref: string | null;
  story: clientTools.ActivityEntry[] | null;
  now: number;
};

function Reader({ item }: { item: DoneReaderProps }) {
  return (
    <article className="mx-auto grid w-[760px] max-w-full content-start">
      <h1 className="m-0 text-[20px] leading-tight font-semibold tracking-[-0.01em] break-words">{item.what}</h1>
      <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">{item.subject}</p>
      {item.canMoveBack || item.candidateHref ? (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {item.canMoveBack ? <MoveBackButton id={item.id} /> : null}
          {item.candidateHref ? (
            <Link href={item.candidateHref} className={cn(button, plain)}>
              Open candidate
            </Link>
          ) : null}
        </div>
      ) : null}
      <section className="mt-5 flex items-center gap-3 border border-[color:var(--line-strong)] bg-[color:var(--paper)] py-3 pr-3 pl-3.5">
        <span aria-hidden className="grid size-[26px] flex-none place-items-center rounded-full bg-[color:var(--green-soft)] text-[color:var(--green)]">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
        </span>
        <div className="grid min-w-0 gap-px">
          <b className="text-[13.5px] font-medium">{item.how}</b>
          {item.since ? <span className="text-[12.5px] break-words text-muted-foreground">{item.since}</span> : null}
        </div>
      </section>
      {item.story ? (
        <section aria-label="Activity" className="mt-7">
          <h2 className="m-0 mb-1 text-[13px] font-medium">Activity</h2>
          <ActivityStory entries={item.story} now={item.now} />
        </section>
      ) : null}
    </article>
  );
}

export function DoneView({
  rows,
  item,
  flash,
  open,
  capped,
}: {
  rows: IssueRow[];
  item: DoneReaderProps | null;
  flash: React.ReactNode;
  open: boolean;
  capped: boolean;
}) {
  if (!item) {
    return (
      <div className="list-reader flex min-h-0 flex-1 flex-col">
        <DoneBar />
        <div className="grid flex-1 content-center justify-items-center gap-2 p-6 text-center">
          {flash}
          <p className="m-0 text-[13px] text-muted-foreground">Nothing here yet.</p>
        </div>
      </div>
    );
  }
  return (
    <ListReader
      listLabel="Done"
      readerLabel="Done item"
      open={open}
      bar={<DoneBar />}
      list={
        <KeyList title="Inbox" next="Next item" mode="select" className="grid content-start gap-0.5">
          {rows.map((r) => (
            <Row key={r.key} r={r} />
          ))}
          {capped ? <p className="m-0 px-3 pt-3 text-[12.5px] text-faint">Showing your newest 200.</p> : null}
        </KeyList>
      }
      reader={
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-3 md:px-6 md:pt-3 md:pb-10">
          <Link href="/client/inbox?tab=done" className={cn(textLink, "md:hidden")}>
            ← All done
          </Link>
          {flash ? <div className="mx-auto w-[760px] max-w-full">{flash}</div> : null}
          <Reader item={item} />
        </div>
      }
    />
  );
}
