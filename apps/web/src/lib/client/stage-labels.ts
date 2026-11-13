// A stage's word, the one the CRM and the hover cards show. In its own module
// with no imports so a "use client" component can read it (client-area.test.ts).
export const STAGE_LABELS: Record<string, string> = {
  sourced: "Sourced",
  contacted: "Contacted",
  screening: "Screening",
  interviewing: "Interviewing",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrew",
};
