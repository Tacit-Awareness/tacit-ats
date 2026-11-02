"use client";

import { useActionState } from "react";
import { useKeyHelp } from "@/components/keys";
import { Notice } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { FEEDBACK_ERRORS, FEEDBACK_NOTES_MAX, RATING_NOTE_MAX, RECOMMENDATIONS, SCALE, type FeedbackDraft, type FeedbackForm as Form, type FeedbackState } from "@/lib/client/feedback-rules";
import { RECOMMENDATION_LABEL } from "@/lib/client/interview-groups";
import { cn } from "@/lib/utils";
import { fileFeedbackAction } from "./actions";

// Your own feedback on an interview you ran: a recommendation, an overall
// rating, the job's scorecard and your notes, filed through the connector's
// submit_feedback. Filing again replaces the earlier one whole. Uncontrolled,
// as the candidate page's note: React resets a form to its defaults when its
// action ends, so the defaults are the refusal's draft or what is on file, and
// a save that lands comes back as the filing the page reads.

const FIRST: FeedbackState = { filed: 0 };

const pill =
  "inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-[13px] shadow-[0_0_0_1px_var(--line-strong)] transition-colors select-none hover:bg-[color:var(--hover)] has-[:checked]:bg-foreground has-[:checked]:text-[color:var(--paper)] has-[:checked]:shadow-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color:var(--accent)]";

/** A row of radio pills; `none` adds a "—" pill for no answer, since a radio cannot be unticked. */
function Choice({ name, legend, options, value, none = false }: { name: string; legend: string; options: { value: string; label: string }[]; value: string; none?: boolean }) {
  return (
    <fieldset className="m-0 grid gap-1.5 border-0 p-0">
      <legend className="mb-1.5 p-0 text-[12.5px] text-muted-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {none ? (
          <label className={pill} title="No rating">
            <input type="radio" name={name} value="" defaultChecked={value === ""} className="sr-only" />—
          </label>
        ) : null}
        {options.map((o) => (
          <label key={o.value} className={pill}>
            <input type="radio" name={name} value={o.value} defaultChecked={value === o.value} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const scale = SCALE.map((n) => ({ value: String(n), label: String(n) }));

export function FeedbackForm({ form, candidate }: { form: Form; candidate: string }) {
  const [state, action] = useActionState(fileFeedbackAction, FIRST);
  const refused = "error" in state ? state : null;
  const draft: FeedbackDraft = refused?.draft ?? form.draft;

  useKeyHelp("Interview Judgement", [{ keys: "⌘↵", label: "File your feedback" }]);

  return (
    <details open={!form.filed || !!refused} className="group/fb border border-[color:var(--line)] bg-[color:var(--surface)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 text-[13.5px] font-medium [&::-webkit-details-marker]:hidden">
        {form.filed ? "Edit your feedback" : "File your feedback"}
        <span aria-hidden className="text-faint transition-transform group-open/fb:rotate-90">
          ›
        </span>
      </summary>
      <form action={action} className="grid gap-4 border-t border-[color:var(--line)] px-3.5 pt-3.5 pb-3.5">
        <input type="hidden" name="interviewId" value={form.interviewId} />
        {refused ? <Notice tone="error">{FEEDBACK_ERRORS[refused.error]}</Notice> : null}
        <Choice
          name="recommendation"
          legend={`Would you hire ${candidate}?`}
          options={RECOMMENDATIONS.map((r) => ({ value: r, label: RECOMMENDATION_LABEL[r] }))}
          value={draft.recommendation ?? ""}
        />
        <Choice name="rating" legend="Overall, 1 to 4 (optional)" options={scale} value={draft.rating === null ? "" : String(draft.rating)} none />
        {form.attributes.length ? (
          <fieldset className="m-0 grid gap-3 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[12.5px] text-muted-foreground">Scorecard, 1 to 4 (optional)</legend>
            {form.attributes.map((a) => (
              <div key={a.attributeId} className="grid gap-1.5">
                <input type="hidden" name="attr" value={a.attributeId} />
                <Choice name={`r:${a.attributeId}`} legend={a.name} options={scale} value={draft.ratings[a.attributeId] ? String(draft.ratings[a.attributeId]) : ""} none />
                {a.description ? <p className="m-0 text-xs text-faint">{a.description}</p> : null}
                <input
                  type="text"
                  name={`rn:${a.attributeId}`}
                  aria-label={`A note on ${a.name}`}
                  defaultValue={draft.ratingNotes[a.attributeId] ?? ""}
                  maxLength={RATING_NOTE_MAX}
                  placeholder="A note on this (optional)"
                  className="h-8 border border-[color:var(--line)] bg-[color:var(--paper)] px-2.5 text-[13px] outline-none placeholder:text-faint focus:border-[color:var(--line-strong)]"
                />
              </div>
            ))}
          </fieldset>
        ) : null}
        <div className="grid gap-1.5">
          <label htmlFor="feedback-notes" className="text-[12.5px] text-muted-foreground">
            Notes
          </label>
          <textarea
            id="feedback-notes"
            name="notes"
            rows={6}
            required
            maxLength={FEEDBACK_NOTES_MAX}
            defaultValue={draft.notes}
            placeholder="What you saw, what you'd probe next round…"
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }}
            className="block min-h-28 w-full resize-y border border-[color:var(--line)] bg-[color:var(--paper)] px-3 py-2.5 text-[13.5px] leading-[1.5] outline-none placeholder:text-faint focus:border-[color:var(--line-strong)]"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span role="status" className={cn("text-[12.5px]", state.filed > 0 && !refused ? "text-foreground" : "text-faint")}>
            {state.filed > 0 && !refused ? "Feedback filed." : form.filed ? "Filing again replaces what you filed." : "Who else reads it follows your company's feedback setting."}
          </span>
          <SubmitButton size="sm" pendingLabel="Filing…" title="File feedback (⌘↵)" className="flex-none">
            {form.filed ? "File again" : "File feedback"}
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}
