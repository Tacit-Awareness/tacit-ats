export type Theme = "system" | "light" | "dark"
export type Routing = { move: "interview" | "testbench" | "decline"; roleId?: string; reason?: string; to?: string; grade?: { confidence?: number; note: string } }
/* Someone passed on for now, kept with the grade so they can be looked at again */
export type Passed = { a: import("./data").Applicant; reason: string; confidence?: number; note: string }
export type View = "home" | "triage" | "tickets" | "people" | "interviews" | "offers" | "asks" | "insights" | "settings"
/* Go-to keys: press G, then the letter, from anywhere you are not typing. K is left alone: it belongs to the command menu. Tickets is W, for the work. */
export const GO_KEYS: Record<View, string> = { home: "H", triage: "T", tickets: "W", people: "P", interviews: "I", offers: "O", asks: "L", insights: "N", settings: "S" }
export type TeamStat = { attn: number; stuck: boolean; triage: number }
