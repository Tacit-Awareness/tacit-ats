"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FUNNEL_INSET, Funnel } from "./funnel";
import { ToneLegend } from "./kit";
import { heading } from "./styles";

// design/tacit-tickets's blocks above a list (rounds.tsx's RoundBlocks, People's
// team blocks): a block per group and a dot per person, the legend beside them.
// Picking a block narrows the page under it: the block's key goes in the URL
// (`param`), and picking it again lets go. A dot opens its person.

export type Block = { key: string; name: string; tone?: string; dots: { id: string; name: string; sub?: string; note?: string; tone?: string; href: string }[] };

export function Blocks({ title, blocks, param, extra }: { title: string; blocks: Block[]; param: string; extra?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const picked = sp.get(param);
  const [hot, setHot] = useState<number | null>(null);
  const go = (key: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (key) next.set(param, key);
    else next.delete(param);
    next.delete("t");
    const q = next.toString();
    router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const pick = (key: string) => go(picked === key ? null : key);
  const at = blocks.findIndex((b) => b.key === picked);
  if (!blocks.length) return null;
  return (
    <div className="px-5 pt-5 pb-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 className={`${heading} tabular-nums`}>{title}</h2>
        <ToneLegend className="ml-auto" />
        {extra}
        {picked && (
          <button type="button" onClick={() => go(null)} className="ml-1 rounded text-mute underline decoration-dim underline-offset-2 hover:text-ink">
            Show All
          </button>
        )}
      </div>
      <div className="scroll-quiet mt-3 overflow-x-auto">
        <div className="mx-auto max-w-[920px] min-w-[520px]">
          <Funnel
            stages={blocks}
            picked={at >= 0 ? at : null}
            hot={hot}
            setHot={setHot}
            onStage={(i) => pick(blocks[i]!.key)}
            onDot={(i, id) => {
              const href = blocks[i]?.dots.find((d) => d.id === id)?.href;
              if (href) router.push(href);
            }}
          />
          <div className="mt-3.5 grid" style={{ gridTemplateColumns: `repeat(${blocks.length}, minmax(0, 1fr))`, marginRight: FUNNEL_INSET }}>
            {blocks.map((b, i) => (
              <button
                type="button"
                key={b.key}
                onClick={() => pick(b.key)}
                aria-pressed={picked === b.key}
                onMouseEnter={() => setHot(i)}
                onMouseLeave={() => setHot(null)}
                className="flex min-w-0 flex-col items-center gap-1 px-1.5 text-center"
              >
                <span className="text-[15px] leading-none font-semibold text-ink tabular-nums">{b.dots.length}</span>
                <span className={`max-w-full truncate leading-tight transition-colors ${hot === i || picked === b.key ? "text-ink" : "text-mute"}`}>{b.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
