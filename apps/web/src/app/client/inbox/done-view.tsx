import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { KeyList } from "@/components/keys";
import { ListReader, StatusGlyph, textLink } from "@/components/page";
import { cn } from "@/lib/utils";
import { ActivityStory } from "../candidates/activity-story";
import { button, plain } from "./buttons";
import { MoveBackButton } from "./set-aside";
import { DoneBar, Row, type IssueRow } from "./view";

// Done's markup, props only: design/tats's Done list and reader, a flat list
// newest first, and the same reader with a line saying how it left. Reached from
// the Inbox card's footer, and its bar goes back there. Nothing here acts on the
// issue but moving it back. Its fix and an offer's terms stay in the Inbox, while
// it is still there to be dealt with. The list is Testbench's rows under
// hairlines; the reader names it in Mona Sans and says how it left in a card.

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
      <h1 className="m-0 font-sans text-[22px] leading-[30px] font-semibold tracking-[-0.02em] break-words">{item.what}</h1>
      <p className="m-0 mt-1 flex flex-wrap gap-x-3 text-[13px] text-faint">
        {item.subject.split(" · ").map((part, i) => (
          <span key={i}>{part}</span>
        ))}
      </p>
      {item.canMoveBack || item.candidateHref ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {item.canMoveBack ? <MoveBackButton id={item.id} /> : null}
          {item.candidateHref ? (
            <Link href={item.candidateHref} className={cn(button, plain)}>
              Open candidate
            </Link>
          ) : null}
        </div>
      ) : null}
      <section className="mt-6 grid grid-cols-[14px_minmax(0,1fr)] items-start gap-3 rounded-[14px] bg-card px-5 py-4 shadow-[var(--shadow)]">
        <span className="pt-[3px]">
          <StatusGlyph kind="done" />
        </span>
        <div className="grid min-w-0 gap-1">
          <b className="font-medium">{item.how}</b>
          {item.since ? <span className="text-[13px] break-words text-muted-foreground">{item.since}</span> : null}
        </div>
      </section>
      {item.story ? (
        <section aria-label="Activity" className="mt-8">
          <h2 className="m-0 mb-2 font-sans text-[15px] leading-5 font-semibold">Activity</h2>
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
        {/* The empty list still sits in the card a full one would, as ListReader's. */}
        <div className="grid flex-1 content-center justify-items-center gap-3 bg-card p-6 text-center md:mx-[var(--page-gutter)] md:mb-[var(--page-gutter)] md:rounded-[14px] md:shadow-[var(--shadow)]">
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
        <KeyList title="Inbox" next="Next item" mode="select" className="-mx-2 -mt-2 grid content-start">
          {rows.map((r) => (
            <Row key={r.key} r={r} />
          ))}
          {capped ? <p className="m-0 border-t border-[color:var(--line)] px-5 py-3 text-[12.5px] text-faint">Showing your newest 200.</p> : null}
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
