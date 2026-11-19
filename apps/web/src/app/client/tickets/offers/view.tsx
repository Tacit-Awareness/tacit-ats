import Link from "next/link";
import { Check, Circle, FileCheck } from "lucide-react";
import { Avatar } from "@/components/tickets/avatar";
import { Header } from "@/components/tickets/header";
import { StatusIcon } from "@/components/tickets/status-icon";
import { heading, label } from "@/components/tickets/styles";
import type { OfferRow } from "@/lib/client/offer-list";
import { OFFER_GROUPS, groupOf, nextStep, signOffSteps } from "@/lib/client/offer-page-rules";
import { offerStatusWord, offerTermLines } from "@/lib/client/offer-rules";
import type { OfferTarget } from "../../candidates/[id]/offer-block";
import { NewOffer, OfferBar } from "./bar";

// The Offer page's three panes (design/tacit-tickets's Offers), drawn from what
// page.tsx read on the member's own token.

const DAY = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export type OfferViewProps = {
  org: string;
  team: string | null;
  rows: OfferRow[];
  sel: OfferRow | null;
  departmentId: string | null;
  candidates: OfferTarget[];
  flash: React.ReactNode;
  capped: boolean;
};

export function OfferView({ org, team, rows, sel, departmentId, candidates, flash, capped }: OfferViewProps) {
  const href = (o: string) => {
    const p = new URLSearchParams({ o });
    if (departmentId) p.set("department", departmentId);
    return `/client/tickets/offers?${p}`;
  };
  const newOffer = <NewOffer candidates={candidates} />;

  if (!sel) {
    return (
      <div className="list-reader flex min-h-0 min-w-0 flex-1 flex-col">
        <Header scope={team} title="Offers" right={newOffer} />
        <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center px-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-sel text-mute">
            <FileCheck size={18} />
          </span>
          <div className="mt-4 font-medium text-ink">No offers yet</div>
          <p className="mt-1.5 max-w-[320px] text-mute">Draft one for someone at offer, or on their page. Its terms and sign-off live here.</p>
        </div>
      </div>
    );
  }

  const o = sel.offer;
  const target = { candidateId: sel.candidateId, applicationId: sel.applicationId, name: sel.name };
  const next = nextStep(o, sel.name, sel.myRequestId);
  const terms = offerTermLines(o);
  const steps = signOffSteps(o);
  const termRows: [string, string | null][] = [
    ["Salary", terms.find((t) => t.label === "Salary")?.value ?? null],
    ["Bonus", o.bonus],
    ["Equity", o.equity],
    ["Start", o.startDate],
    ["Expires", o.expiresOn],
  ];

  return (
    <>
      <div className="list-reader flex min-h-0 min-w-0 flex-1">
        <div className="@container flex min-w-0 flex-1">
          {/* The queue */}
          <div className="flex w-[208px] shrink-0 flex-col border-r border-line max-lg:hidden">
            <Header scope={team} title="Offers" right={newOffer} />
            <nav aria-label="Offers" className="scroll-quiet flex-1 overflow-y-auto p-1.5">
              {OFFER_GROUPS.map((g) => {
                const group = rows.filter((r) => groupOf(r.offer, !!r.myRequestId) === g.key);
                if (!group.length) return null;
                return (
                  <section key={g.key} className="mb-1.5">
                    <div className="flex h-8 items-center gap-2 px-3 text-xs text-dim">
                      {g.label} <span className="tabular-nums">{group.length}</span>
                    </div>
                    {group.map((r) => (
                      <Link
                        key={r.offer.offerId}
                        href={href(r.offer.offerId)}
                        aria-current={r === sel ? "true" : undefined}
                        className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${r === sel ? "bg-sel" : "hover:bg-hover"}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{r.name}</span>
                          <span className="block truncate text-mute">{r.jobTitle}</span>
                        </span>
                      </Link>
                    ))}
                  </section>
                );
              })}
              {capped && <p className="px-3 py-2 text-xs text-dim">Showing the newest 300.</p>}
            </nav>
          </div>

          {/* The offer, as tATS records it */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pr-3 pl-5 text-mute">
              <span className="mr-1 min-w-0 truncate font-medium text-ink">{sel.name}</span>
              <span className="min-w-0 truncate">{sel.jobTitle}</span>
              <span className="ml-auto shrink-0 rounded-md bg-sel px-1.5 py-px text-xs text-body">{offerStatusWord(o.status)}</span>
            </div>
            {flash && <div className="shrink-0 border-b border-line px-5 py-2">{flash}</div>}
            <div key={o.offerId} className="scroll-quiet @container min-h-0 flex-1 overflow-y-auto bg-well px-4 py-5 @max-2xl:px-3">
              <article className="anim-rise mx-auto w-full max-w-[816px] bg-white px-[72px] py-[64px] text-[14px] leading-[1.7] text-[#26262a] shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_10px_-2px_rgba(0,0,0,0.25)] @max-4xl:px-10 @max-4xl:py-12 @max-2xl:px-6 @max-2xl:py-8">
                <div className="text-center text-[15px] font-bold tracking-[-0.01em] text-black">{org}</div>
                <p className="mt-10">{DAY.format(new Date(o.createdAt))}</p>
                <p className="mt-6 text-[17px] font-semibold text-black">Offer for {sel.name}</p>
                <p className="mt-1">{sel.jobTitle}</p>
                <dl className="mt-8 grid grid-cols-[120px_minmax(0,1fr)] gap-y-3 border-t border-[#e4e4e8] pt-6">
                  {termRows.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-[#77777f]">{k}</dt>
                      <dd className="m-0 min-w-0 break-words">{v ? <span className="font-semibold text-black">{v}</span> : <span className="rounded bg-[#fff3c4] px-1.5 text-[#7a5b00]">Not set</span>}</dd>
                    </div>
                  ))}
                </dl>
                {o.notes && <p className="mt-8 border-t border-[#e4e4e8] pt-6 break-words whitespace-pre-wrap">{o.notes}</p>}
              </article>
            </div>
            <OfferBar key={`${o.offerId}-${o.status}-${o.approval?.status ?? ""}`} target={target} offer={o} next={next} />
          </div>
        </div>

        {/* The terms and who has signed off */}
        <aside aria-label="Offer" className="scroll-quiet hidden w-[300px] shrink-0 overflow-y-auto border-l border-line xl:block">
          <div key={o.offerId} className="anim-rise px-5 py-5">
            <Link href={`/client/candidates/${sel.candidateId}`} className={`${heading} block max-w-full truncate hover:underline`}>
              {sel.name}
            </Link>
            <div className="truncate text-mute">{sel.jobTitle}</div>

            <div className={`${label} mt-6`}>Terms</div>
            <dl className="overflow-hidden rounded-lg border border-line-strong">
              {termRows.map(([k, v]) => (
                <div key={k} className="flex h-10 items-center gap-3 border-b border-line px-3.5 last:border-b-0">
                  <dt className="w-16 shrink-0 text-mute">{k}</dt>
                  <dd className={`min-w-0 flex-1 truncate ${v ? "text-ink" : "text-dim"}`}>{v ?? "Not set"}</dd>
                </div>
              ))}
            </dl>

            <div className={`${label} mt-7`}>Sign-Off</div>
            <ol>
              {steps.map((st, i) => (
                <li key={i} className="flex h-9 items-center gap-2.5">
                  {st.done ? <Check size={14} className="shrink-0 text-s-scheduled" /> : st.now ? <StatusIcon status="needs" /> : <Circle size={13} className="shrink-0 text-dim" />}
                  <span className={`min-w-0 flex-1 truncate ${st.done || st.now ? "text-ink" : "text-mute"}`}>{st.name}</span>
                  {st.note && <span className="text-xs text-dim">{st.note}</span>}
                  {st.who && <Avatar name={st.who} size={18} />}
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
