// design/tats's hover cards (`hcApplicant`, `hcPerson`), the pure half, safe for
// the browser: what a name in a list says it is, who may raise a card, where one
// sits, and the shape the read answers with. The reads are lib/client/hover-card.ts,
// the React half components/hover-card.tsx.

export type HoverKind = "candidate" | "member";
export type HoverTarget = { kind: HoverKind; id: string };

/** One line of a card. A line the member may not read is left out, never drawn empty. */
export type HoverRow = { label: string; value: string; faint?: string };

export type HoverCardData = {
  kind: HoverKind;
  name: string;
  line: string | null;
  /** A candidate's stage on their lead job, and how long since it was touched. */
  state: { stage: string; note: string } | null;
  rows: HoverRow[];
  link: { href: string; label: string } | null;
};

const PREFIX: Record<HoverKind, string> = { candidate: "c", member: "m" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `data-hc` on a name or an avatar, as the prototype's: `c:<person id>`, `m:<member id>`. */
export const hoverAttr = (kind: HoverKind, id: string) => `${PREFIX[kind]}:${id}`;

/** What `data-hc`, or the route's `t`, names. Request data: anything else is nothing. */
export function parseHoverTarget(raw: string | null | undefined): HoverTarget | null {
  const m = /^([cm]):(.+)$/.exec(raw ?? "");
  if (!m || !UUID.test(m[2]!)) return null;
  return { kind: m[1] === "c" ? "candidate" : "member", id: m[2]!.toLowerCase() };
}

/** Only a mouse or a pen rests on something. A finger never raises a card. */
export const raisesCard = (pointerType: string) => pointerType === "mouse" || pointerType === "pen";

/** The prototype's rest on a name; shorter once a card is up, moving between names. */
export const restMs = (cardUp: boolean) => (cardUp ? 60 : 420);

/** Under the name and clamped to the window, or above it when there's no room below. */
export function placeCard(
  anchor: { left: number; top: number; bottom: number },
  card: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } {
  const gap = 8;
  const left = Math.max(gap, Math.min(anchor.left, view.width - card.width - gap));
  const below = anchor.bottom + 6;
  return { left, top: below + card.height > view.height - gap ? Math.max(gap, anchor.top - card.height - 6) : below };
}

/** A card read this recently is drawn again without asking: long enough for a mouse crossing a list twice. */
export const CARD_FRESH_MS = 30_000;
