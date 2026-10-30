import type { clientTools } from "@tacit-ats/core";
import type { ScheduleAnswer } from "./schedule-requests";

// What the Calendar's confirmations and notices say, from core's dry run and
// its results. Pure, and only type imports from core, for a client component,
// and unit-tested: a confirmation is a promise about what Google will do, so
// each sentence is held to the outcome it stands for.

type Conflicts = clientTools.InterviewConflicts;
type BookCalendar = clientTools.SchedulePreview["calendar"];
type ChangeCalendar = clientTools.UpdatePreview["calendar"];

/** "A", "A and B", "A, B and C". */
export function names(list: readonly string[]): string {
  if (list.length < 2) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

/** Who cannot make it, and whose calendar nobody could read. Unread is said, never assumed free. */
export function conflictLines(c: Conflicts): string[] {
  return [
    ...(c.busy.length ? [`${names(c.busy.map((p) => p.name))} ${c.busy.length === 1 ? "has" : "have"} something else on then.`] : []),
    ...(c.unknown.length ? [`Not checked: ${names(c.unknown.map((p) => p.name))}. Tacit could not read ${c.unknown.length === 1 ? "that calendar" : "those calendars"}.`] : []),
  ];
}

const NOT_SENT: Record<Extract<BookCalendar, { status: "not_sent" }>["reason"], string> = {
  not_connected: "Neither your calendar nor any interviewer's is connected, so this is recorded in Tacit only. Nobody is invited.",
  not_set_up: "Calendars are not set up here, so this is recorded in Tacit only. Nobody is invited.",
  not_asked: "This is recorded in Tacit only. Nothing goes on a calendar, and nobody is invited.",
  in_the_past: "That time has passed, so this is recorded in Tacit only. Nobody is invited.",
  connection_expired: "Your Google connection has expired, and no interviewer's calendar is connected. Reconnect it on Integrations, or record this in Tacit only, where nobody is invited.",
};

/** The Confirm card's sentences for a booking: whose calendar, and who hears from Google. */
export function bookLines(calendar: BookCalendar): string[] {
  if (calendar.status === "not_sent") return [NOT_SENT[calendar.reason]];
  const guests = [...calendar.invited.map((p) => p.name), ...(calendar.candidateEmail ? [`the candidate at ${calendar.candidateEmail}`] : [])];
  return [
    `This goes on ${calendar.organizer.name}'s Google Calendar${calendar.meetLink ? ", with a Meet link" : ""}.`,
    guests.length ? `Google emails an invite to ${names(guests)}.` : "Google invites nobody else.",
    ...(calendar.candidateEmail ? [] : ["The candidate has no usable email on file, so they are not invited."]),
    ...(calendar.notInvited.length ? [`${names(calendar.notInvited.map((p) => p.name))} ${calendar.notInvited.length === 1 ? "has" : "have"} no address on file, so ${calendar.notInvited.length === 1 ? "is" : "are"} not invited.`] : []),
  ];
}

/** The Confirm card's sentences for a move or a cancel. */
export function changeLines(calendar: ChangeCalendar): string[] {
  switch (calendar.status) {
    case "would_follow": {
      const told = `Google tells everyone on it${calendar.candidateEmail ? ", the candidate too" : ""}.`;
      return [
        calendar.action === "cancel"
          ? `This deletes the event from ${calendar.organizer.name}'s Google Calendar. ${told}`
          : `This moves the event on ${calendar.organizer.name}'s Google Calendar. ${told}`,
        ...(calendar.candidateEmail ? [] : ["The candidate has no usable email on file, so Google cannot tell them."]),
      ];
    }
    case "blocked":
      return [
        calendar.reason === "not_set_up"
          ? "Calendars are not set up here, so the event cannot follow."
          : calendar.yours
            ? "The event is on your calendar, which is not connected now. Reconnect it on Integrations, or change Tacit's record only."
            : `The event is on ${calendar.organizer?.name ?? "someone else"}'s calendar, which is not connected now. They can reconnect it on Integrations, or you can change Tacit's record only.`,
        "Tacit's record only means the calendar event stays as it is, and nobody is told.",
      ];
    case "left_alone":
      return ["The calendar event stays as it is, and nobody is told."];
    case "none":
      return ["This interview is not on a calendar, so only Tacit's record changes. Nobody is told."];
  }
}

/** The line under the bar once it is done: what is now true, and what was not. */
export function doneSentence(answer: Extract<ScheduleAnswer, { ok: true; kind: "booked" | "changed" | "unchanged" | "already_booked" }>): string {
  if (answer.kind === "unchanged") return "Nothing changed: it was already that way.";
  if (answer.kind === "already_booked") return "Booked. The earlier try went through, so nothing was booked twice.";
  if (answer.kind === "booked") {
    const c = answer.calendar;
    if (c.status === "not_sent") return "Booked in Tacit only. Nobody was invited.";
    const place = `Booked on ${c.organizer.name}'s calendar.`;
    return c.candidateInvited ? `${place} Google invited the candidate and the interviewers.` : `${place} Google invited the interviewers; the candidate has no usable email on file.`;
  }
  const verb = answer.op === "move" ? "Moved" : "Cancelled";
  switch (answer.calendar) {
    case "moved":
      return "Moved. The calendar event followed, and Google told everyone on it.";
    case "cancelled":
      return "Cancelled. The calendar event is gone, and Google told everyone on it.";
    case "already_gone":
      return "Cancelled. Its calendar event was already gone.";
    case "left_alone":
      return `${verb} in Tacit only. The calendar event stays as it is.`;
    default:
      return `${verb} in Tacit. It was not on a calendar.`;
  }
}
