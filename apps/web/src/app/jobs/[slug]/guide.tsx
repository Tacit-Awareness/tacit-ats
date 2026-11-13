"use client";

import { useEffect, useState } from "react";
import { Ico, ICON } from "@/components/careers/frame";
import { StatusGlyph } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { guideProgress, type GuideStep } from "@/lib/public/application";

// The application's checklist (design/careers): a white card beside the form,
// or a bar at the bottom of a narrow window. Each section's square fills as
// Testbench's status glyphs do (empty, under way, done) rather than carrying a
// number. It only watches the form: the form posts with no script, and this
// adds nothing to what is sent.

export const APPLY_FORM = "apply";

function answered(form: HTMLFormElement, field: string): boolean {
  const el = form.elements.namedItem(field);
  if (!el) return false;
  if (el instanceof RadioNodeList) return el.value !== "";
  const input = el as HTMLInputElement;
  return input.value.trim() !== "" && input.validity.valid;
}

function useDone(steps: GuideStep[]): ReadonlySet<string> {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const form = document.getElementById(APPLY_FORM);
    if (!(form instanceof HTMLFormElement)) return;
    const read = () => setDone(new Set(steps.flatMap((s) => s.items).filter((i) => answered(form, i.field)).map((i) => i.field)));
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, [steps]);
  return done;
}

function jumpTo(field: string | undefined) {
  const form = document.getElementById(APPLY_FORM);
  if (!(form instanceof HTMLFormElement)) return;
  const el = field ? form.elements.namedItem(field) : form.querySelector("[type=submit]");
  const target = (el instanceof RadioNodeList ? el[0] : el) as HTMLElement | null;
  target?.focus();
}

function Bar({ share }: { share: number }) {
  return (
    <div className="g-bar">
      <span className="g-fill" style={{ transform: `scaleX(${share})` }} />
    </div>
  );
}

export function ApplicationGuide({ steps }: { steps: GuideStep[] }) {
  const done = useDone(steps);
  const { total, finished, next, current } = guideProgress(steps, done);
  return (
    <div className={`guide${finished === total ? " complete" : ""}`} aria-label="Your application">
      <div className="g-head">
        <h3>Your application</h3>
        <span className="g-count">
          {finished}/{total}
        </span>
      </div>
      <Bar share={total ? finished / total : 0} />
      {steps.map((s) => {
        const complete = s.items.every((item) => done.has(item.field));
        return (
          <div key={s.key} className={`g-step${complete ? " is-done" : ""}${current === s.key ? " is-cur" : ""}`}>
            <span className="g-node" aria-hidden>
              <StatusGlyph kind={complete ? "done" : current === s.key ? "half" : "empty"} className="size-4" />
            </span>
            <span className="g-title">{s.title}</span>
            {s.items.map((item) => (
              <button key={item.field} type="button" className="g-item" role="checkbox" aria-checked={done.has(item.field)} title={item.label} onClick={() => jumpTo(item.field)}>
                <span className="g-check">
                  <Ico d={ICON.check} />
                </span>
                <span className="g-lbl">{item.label}</span>
              </button>
            ))}
          </div>
        );
      })}
      <div className="g-foot">
        <span>{next ? `Next: ${next.label}` : "Ready"}</span>
        <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => jumpTo(next?.field)}>
          {next ? "Go" : "Review"}
        </button>
      </div>
    </div>
  );
}

/** The checklist on a phone. */
export function ApplicationBar({ steps }: { steps: GuideStep[] }) {
  const done = useDone(steps);
  const { total, finished, next } = guideProgress(steps, done);
  return (
    <div className={`mbar${finished === total ? " complete" : ""}`}>
      <div className="grow">
        <div className="t">
          <b>{next ? `Next: ${next.label}` : "Ready"}</b>
          <span>
            {finished}/{total}
          </span>
        </div>
        <Bar share={total ? finished / total : 0} />
      </div>
      <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => jumpTo(next?.field)}>
        {next ? "Go" : "Review"}
      </button>
    </div>
  );
}
