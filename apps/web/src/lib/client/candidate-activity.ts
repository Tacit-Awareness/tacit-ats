import type { clientTools } from "@tacit-ats/core";
import { stageLabel } from "./crm-views";

// The candidate page's activity feed, one sentence per entry of core's
// getActivity. Pure. `body` is member-written or candidate-derived text (a
// note, a tag, an email's subject, an approver's reason): the view renders it
// as plain text, never as markup.

export type ActivityLine = {
  /** What happened, after the actor's name ("moved them to Interviewing"). */
  what: string;
  body: string | null;
};

type Entry = clientTools.ActivityEntry;

const on = (e: Entry) => (e.jobTitle ? ` for ${e.jobTitle}` : "");
const stage = (s: string | null) => stageLabel(s ?? "sourced");

const OFFER: Partial<Record<clientTools.ActivityKind, string>> = {
  "offer.drafted": "drafted an offer",
  "offer.extended": "extended an offer",
  "offer.accepted": "recorded the offer accepted",
  "offer.declined": "recorded the offer declined",
  "offer.withdrawn": "withdrew the offer",
  "approval.requested": "asked for the offer's approval",
  "approval.approved": "approved the offer",
  "approval.rejected": "turned down the offer's approval",
  "approval.reset": "reset the offer's approval",
  "approval.cancelled": "cancelled the offer's approval",
};

export function activityLine(e: Entry): ActivityLine {
  switch (e.kind) {
    case "application.added":
      return { what: `added them${on(e)} at ${stage(e.toStage)}`, body: e.text };
    case "application.stage_changed":
      return { what: `moved them${e.fromStage ? ` from ${stage(e.fromStage)}` : ""} to ${stage(e.toStage)}${on(e)}`, body: e.text };
    case "application.owner_changed":
      return { what: e.people[0] ? `made ${e.people[0]} the owner${on(e)}` : `cleared the owner${on(e)}`, body: null };
    case "application.next_action":
      return { what: e.text ? `set the next action${on(e)}` : `cleared the next action${on(e)}`, body: e.text };
    case "application.touched":
      return { what: `logged a touch${on(e)}`, body: e.text };
    case "application.note":
    case "note":
      return { what: `left a note${on(e)}`, body: e.text };
    case "interview.scheduled":
      return { what: `scheduled ${e.text ? `the ${e.text} interview` : "an interview"}${on(e)}`, body: e.people.length ? `With ${e.people.join(", ")}` : null };
    case "interview.done":
      return { what: `marked ${e.text ? `the ${e.text} interview` : "an interview"} done${on(e)}`, body: null };
    case "interview.cancelled":
      return { what: `cancelled ${e.text ? `the ${e.text} interview` : "an interview"}${on(e)}`, body: null };
    case "tag.added":
      return { what: "tagged them", body: e.text };
    case "email":
      return { what: "emailed them", body: e.text };
    case "email.reply":
      return { what: "replied by email", body: e.text };
    case "email.out":
      return { what: "emailed them", body: e.text };
    case "email.in":
      return { what: "wrote by email", body: e.text };
    default:
      return { what: `${OFFER[e.kind] ?? e.kind.replace(/[._]/g, " ")}${on(e)}`, body: e.text };
  }
}
