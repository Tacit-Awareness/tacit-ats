// design/tats's tutorial, the pure half (components/app-shell/shell-tour.tsx
// is the React half): the steps, one spotlight each, and where the card goes
// beside the spotlight. Unit-tested in tour.test.ts.

export type TourStep = {
  /** The page the step is on; null stays on the current page. */
  href: string | null;
  /** What to spotlight, the first that matches and is on screen; none centres the card. */
  targets: string[];
  title: string;
  body: string;
};

// design/tats's tour, for the pages that exist: its Grokbot Activity and Chat
// steps are left out with nothing behind them, and its Inbox key bar step is
// part of the Inbox's own.
export const TOUR: TourStep[] = [
  {
    href: "/client",
    targets: ['aside a[href="/client"]'],
    title: "Home",
    body: "Start here. The Recruiting Overview shows where hiring is slow, and links each delay to the page that clears it.",
  },
  {
    href: "/client",
    targets: ['[data-tour="kpis"]'],
    title: "The numbers that matter",
    body: "Applications coming in, who's in process, how long each step takes, and how much interviewing the team is doing. Admins can set a target on a card.",
  },
  {
    href: "/client",
    targets: ['[data-tour="stuck"]'],
    title: "Where candidates are stuck",
    body: "Bottlenecks beside time in each stage of your interview process, so you see what's slow and where to fix it.",
  },
  {
    href: "/client/inbox",
    targets: ['[data-tour="inbox-keys"]', '[data-tour="inbox"]'],
    title: "Inbox",
    body: "Only what's stuck or waiting on you, on one card. Open an issue, or use a row's own buttons: F runs the fix and E sets it aside under Done. On a decision, A, O and R move it on, and each asks you first. So does Send here, on a draft you never sent.",
  },
  {
    href: "/client/candidates",
    targets: ['[data-tour="crm"]'],
    title: "CRM",
    body: "Everyone you can see, one table: in process, and everyone the funnel has closed, hired or not. X selects a row, to reject, tag or add to a pool in bulk.",
  },
  {
    href: "/client/jobs",
    targets: ['[data-tour="add-role"]', 'aside a[href="/client/jobs"]'],
    title: "Job Postings",
    body: "Your careers page as applicants see it. Open a role to edit it in place: the posting, the application, the hiring steps and whether it's live.",
  },
  {
    href: "/client/applicants",
    targets: ['[data-tour="route"]', '[data-tour="tickets"]'],
    title: "Applicant Tickets",
    body: "New applicants, read like email. R writes a reply: you read the draft, then Send. Pick Interview, Screening or Decline, then press the button beside it, or Enter after a key, and the next one opens.",
  },
  {
    href: "/client/pipeline",
    targets: ['[data-tour="board"]'],
    title: "Pipeline",
    body: "It opens on who's stuck, with every stage across the top; Everyone shows the rest. A row opens the person over the list. Pick a job for its board, then drag a card to another column to move them, or press S on it.",
  },
  {
    href: "/client/interviews",
    targets: ['[data-tour="interviews"]'],
    title: "Interviews",
    body: "Where a candidate is in their loop, who has met them, and how each round went. Check one off when you have been through it, or press E.",
  },
  {
    href: "/client/referrals",
    targets: ['[data-tour="refer"]'],
    title: "Referrals",
    body: "Who referred whom and where they are now. Add one here.",
  },
  {
    href: "/client/onboarding/people",
    targets: ['[data-tour="onboarding"]', 'aside a[href="/client/onboarding/people"]'],
    title: "Onboarding",
    body: "Your company's setup, one step at a time, with a checklist of what's done. Admins invite people and set their access here, and can come back whenever the team changes. Nothing makes you finish it.",
  },
  {
    href: null,
    targets: ['[data-tour="keys"]'],
    title: "One key per action",
    body: "G then a letter goes to a page, J and K move through a list, and ? shows every key on the page you're on.",
  },
];

/**
 * Whether the step's page is the one showing. Home's tabs share its path, so
 * `?sub=` on Home is another page: the Overview's cards aren't on it.
 */
export const onStepPage = (href: string, pathname: string, sub: string | null) => pathname === href && !(href === "/client" && sub);

/** What a step can spotlight: on a phone the sidebar is a closed drawer, so never one of its links. */
export const tourTargets = (targets: string[], phone: boolean) => (phone ? targets.filter((t) => !t.startsWith("aside ")) : targets);

export type Box = { left: number; top: number; width: number; height: number };

/** How far the spotlight reaches past its element, the card's gap from it and from the window's edge. */
export const SPOT_PAD = 8;
const GAP = 16;
const EDGE = 16;

/**
 * Where the spotlight and the card go, as design/tats: the card right of the
 * element, else below it, else above, always inside the window. No element
 * (or one off screen) means no spotlight and the card in the middle.
 */
export function placeTour(el: Box | null, view: { width: number; height: number }, card: { width: number; height: number }): { spot: Box | null; card: { left: number; top: number } } {
  if (!el) return { spot: null, card: { left: Math.max(EDGE, (view.width - card.width) / 2), top: Math.max(EDGE, (view.height - card.height) / 2) } };
  const spot = { left: el.left - SPOT_PAD, top: el.top - SPOT_PAD, width: el.width + SPOT_PAD * 2, height: el.height + SPOT_PAD * 2 };
  const right = el.left + el.width;
  const bottom = el.top + el.height;
  let x = right + GAP;
  let y = el.top;
  if (x + card.width > view.width - EDGE) {
    x = Math.max(EDGE, Math.min(el.left, view.width - card.width - EDGE));
    y = bottom + GAP;
  }
  if (y + card.height > view.height - EDGE) y = Math.max(EDGE, el.top - card.height - GAP);
  if (y < EDGE) y = Math.max(EDGE, Math.min(view.height - card.height - EDGE, el.top + EDGE));
  return { spot, card: { left: x, top: y } };
}

/** True when a box is drawn and at least partly inside the window: a collapsed drawer's link or a hidden button is not. */
export function onScreen(b: Box, view: { width: number; height: number }): boolean {
  return b.width > 0 && b.height > 0 && b.left + b.width > 0 && b.top + b.height > 0 && b.left < view.width && b.top < view.height;
}
