"use client";

import { useEffect, useState } from "react";
import { Ico, ICON } from "@/components/careers/frame";
import { guideProgress, type GuideStep } from "@/lib/public/application";

// The application's checklist (design/careers): the role's side column while
// the form is filled, or a bar at the bottom of a narrow window. Every section
// is shown with a numbered node and a line to the next; a finished one turns
// green, and what was entered shows beside its item. It only watches the form:
// the form posts with no script, and this adds nothing to what is sent.

export const APPLY_FORM = "apply";

function answered(form: HTMLFormElement, field: string): boolean {
  const el = form.elements.namedItem(field);
  if (!el) return false;
  if (el instanceof RadioNodeList) return el.value !== "";
  const input = el as HTMLInputElement;
  return input.value.trim() !== "" && input.validity.valid;
}

/** What an answered field reads as beside its item: the text typed, the file's name, the choice made. */
function shown(form: HTMLFormElement, field: string): string {
  const el = form.elements.namedItem(field);
  if (!el) return "";
  if (el instanceof RadioNodeList) return el.value === "yes" ? "Yes" : el.value === "no" ? "No" : el.value;
  if (el instanceof HTMLInputElement && el.type === "file") return el.files?.[0]?.name ?? "";
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text ?? "";
  return (el as HTMLInputElement).value.trim().replace(/\s+/g, " ");
}

function useDone(steps: GuideStep[]): ReadonlyMap<string, string> {
  const [done, setDone] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const form = document.getElementById(APPLY_FORM);
    if (!(form instanceof HTMLFormElement)) return;
    const read = () =>
      setDone(
        new Map(
          steps
            .flatMap((s) => s.items)
            .filter((i) => answered(form, i.field))
            .map((i) => [i.field, shown(form, i.field)]),
        ),
      );
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
  const { total, finished, next, current } = guideProgress(steps, new Set(done.keys()));
  return (
    <div className={`guide${finished === total ? " complete" : ""}`} role="group" aria-label="Your application">
      <div className="g-head">
        <h3>Your application</h3>
        <span className="g-count">
          {finished}/{total}
        </span>
      </div>
      <Bar share={total ? finished / total : 0} />
      {steps.map((s, n) => {
        const complete = s.items.every((item) => done.has(item.field));
        return (
          <div key={s.key} className={`g-step${complete ? " is-done" : ""}${current === s.key ? " is-cur" : ""}`}>
            <span className="g-node" aria-hidden>
              <i>{n + 1}</i>
              <Ico d={ICON.check} />
            </span>
            <span className="g-title">{s.title}</span>
            <div className="g-items">
              {s.items.map((item) => {
                const value = done.get(item.field);
                return (
                  <button key={item.field} type="button" className="g-item" role="checkbox" aria-checked={value !== undefined} title={value ? `${item.label}: ${value}` : item.label} onClick={() => jumpTo(item.field)}>
                    <span className="g-check">
                      <Ico d={ICON.check} />
                    </span>
                    <span className="g-lbl">{item.label}</span>
                    {value ? <span className="g-val">{value}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="g-foot">
        <span>{next ? `Next: ${next.label}` : "Ready"}</span>
        <button type="button" className="btn sm" onClick={() => jumpTo(next?.field)}>
          {next ? "Go" : "Review"}
        </button>
      </div>
    </div>
  );
}

/** The checklist on a phone. */
export function ApplicationBar({ steps }: { steps: GuideStep[] }) {
  const done = useDone(steps);
  const { total, finished, next } = guideProgress(steps, new Set(done.keys()));
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
      <button type="button" className="btn sm" onClick={() => jumpTo(next?.field)}>
        {next ? "Go" : "Review"}
      </button>
    </div>
  );
}
